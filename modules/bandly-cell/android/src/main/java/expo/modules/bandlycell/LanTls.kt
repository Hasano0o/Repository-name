package expo.modules.bandlycell

import java.net.InetAddress
import java.net.Socket
import java.security.KeyStore
import java.security.cert.CertificateException
import java.security.cert.X509Certificate
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509ExtendedTrustManager
import javax.net.ssl.X509TrustManager
import okhttp3.OkHttpClient

/**
 * راوترات تفرض https بشهادة ذاتية (Huawei H112-370 من Three — ٣١ أكتوبر ٢٠٢٦: «A TLS error»).
 *
 * نقبل الشهادة غير الموثّقة **بس** لما الطرف الثاني عنوان محلي فعلاً (192.168.x / 10.x / 172.16-31.x / 169.254.x)
 * — نتحقق من عنوان السوكت الحقيقي، مو من الاسم. أي اتصال ثاني (السيرفر، التحديثات، Cloudflare)
 * يمر على فحص النظام العادي كما هو بالضبط.
 */
object LanTls {
  private fun isLan(addr: InetAddress?): Boolean =
    addr != null && !addr.isLoopbackAddress && (addr.isSiteLocalAddress || addr.isLinkLocalAddress)

  private val PRIVATE_V4 = Regex("""^(10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)""")
  private val LOCAL_SUFFIX = listOf(".local", ".lan", ".home", ".internal")

  /** اسم محلي؟ (للتحقق من اسم الشهادة — الشهادة الذاتية غالباً ما فيها العنوان) */
  private fun localName(host: String?): Boolean {
    val h = (host ?: return false).lowercase()
    if (Regex("""^\d{1,3}(\.\d{1,3}){3}$""").matches(h)) return PRIVATE_V4.containsMatchIn(h)
    if (LOCAL_SUFFIX.any { h.endsWith(it) }) return true
    return !h.contains('.') && !h.contains(':')
  }

  private val system: X509TrustManager by lazy {
    val f = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    f.init(null as KeyStore?)
    f.trustManagers.filterIsInstance<X509TrustManager>().first()
  }

  private class LanTrust : X509ExtendedTrustManager() {
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) {
      val ext = system as? X509ExtendedTrustManager
      try {
        // فحص النظام الكامل (مع الاسم) — نفس اللي يصير بدون هالملف
        if (ext != null) ext.checkServerTrusted(chain, authType, socket) else system.checkServerTrusted(chain, authType)
      } catch (e: CertificateException) {
        if (!isLan(socket?.inetAddress)) throw e
      }
    }
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) {
      val ext = system as? X509ExtendedTrustManager
      if (ext != null) ext.checkServerTrusted(chain, authType, engine) else system.checkServerTrusted(chain, authType)
    }
    private fun sys(chain: Array<out X509Certificate>?, authType: String?, peerLan: Boolean) {
      try {
        system.checkServerTrusted(chain, authType)
      } catch (e: CertificateException) {
        if (!peerLan) throw e
      }
    }
    override fun checkServerTrusted(chain: Array<out X509Certificate>?, authType: String?) =
      sys(chain, authType, false)
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, socket: Socket?) =
      system.checkClientTrusted(chain, authType)
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?, engine: SSLEngine?) =
      system.checkClientTrusted(chain, authType)
    override fun checkClientTrusted(chain: Array<out X509Certificate>?, authType: String?) =
      system.checkClientTrusted(chain, authType)
    override fun getAcceptedIssuers(): Array<X509Certificate> = system.acceptedIssuers
  }

  private val trust: X509TrustManager by lazy { LanTrust() }
  private val factory: SSLSocketFactory by lazy {
    SSLContext.getInstance("TLS").apply { init(null, arrayOf(trust), null) }.socketFactory
  }

  /** الاسم: النظام أول؛ لو رفض واسم الراوتر محلي نقبل (الشهادة الذاتية ما تحمل العنوان) */
  private val names = HostnameVerifier { host, session ->
    HttpsURLConnection.getDefaultHostnameVerifier().verify(host, session) || localName(host)
  }

  fun apply(b: OkHttpClient.Builder): OkHttpClient.Builder =
    try { b.sslSocketFactory(factory, trust).hostnameVerifier(names) } catch (ignored: Throwable) { b }
}
