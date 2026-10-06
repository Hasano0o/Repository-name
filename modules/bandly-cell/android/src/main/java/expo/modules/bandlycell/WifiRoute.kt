package expo.modules.bandlycell

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import com.facebook.react.modules.network.OkHttpClientFactory
import com.facebook.react.modules.network.OkHttpClientProvider
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketAddress
import javax.net.SocketFactory
import okhttp3.OkHttpClient

/**
 * يخلّي طلبات الراوتر (العناوين المحلية 192.168.x / 10.x / 172.16-31.x) تطلع دايماً عبر الواي فاي.
 *
 * المشكلة: لما تنقطع الأبراج عن الراوتر، أندرويد يشوف الواي فاي «بلا إنترنت» ويحوّل
 * طلبات التطبيق على بيانات الجوال — فطلب 192.168.0.1 يروح للشبكة الخلوية وما يوصل للراوتر.
 *
 * الحل: نربط كل اتصال لعنوان محلي بشبكة الواي فاي نفسها (Network.bindSocket)،
 * وباقي الطلبات (السيرفر، وضع الفني، الإحصائيات) تمشي على الشبكة الافتراضية كالعادة
 * — يعني لو الراوتر طايح، وضع الفني يشتغل على بيانات الجوال والراوتر يتحكم فيه عبر الواي فاي.
 */
object WifiRoute {
  @Volatile private var wifi: Network? = null
  private var started = false

  fun install(context: Context) {
    if (started) return
    started = true
    val app = context.applicationContext
    try {
      val cm = app.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      val req = NetworkRequest.Builder()
        .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
        .build()
      cm.registerNetworkCallback(req, object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) { wifi = network }
        override fun onLost(network: Network) { if (wifi == network) wifi = null }
      })
    } catch (ignored: Throwable) {
      return // ما نقدر نراقب الواي فاي — نخلي fetch على وضعه الطبيعي
    }

    OkHttpClientProvider.setOkHttpClientFactory(object : OkHttpClientFactory {
      override fun createNewNetworkModuleClient(): OkHttpClient =
        OkHttpClientProvider.createClientBuilder(app)
          .socketFactory(LanOverWifiSocketFactory)
          .build()
    })
  }

  private fun isLan(addr: InetAddress?): Boolean =
    addr != null && !addr.isLoopbackAddress && (addr.isSiteLocalAddress || addr.isLinkLocalAddress)

  /** قبل الاتصال: لو الوجهة محلية والواي فاي موجود، نربط السوكت بالواي فاي */
  private class LanSocket : Socket() {
    override fun connect(endpoint: SocketAddress?, timeout: Int) {
      val net = wifi
      if (net != null && endpoint is InetSocketAddress && isLan(endpoint.address)) {
        try { net.bindSocket(this) } catch (ignored: Throwable) {}
      }
      super.connect(endpoint, timeout)
    }
  }

  private object LanOverWifiSocketFactory : SocketFactory() {
    private val def = SocketFactory.getDefault()
    override fun createSocket(): Socket = LanSocket()
    override fun createSocket(host: String?, port: Int): Socket =
      LanSocket().apply { connect(InetSocketAddress(host, port)) }
    override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
      def.createSocket(host, port, localHost, localPort)
    override fun createSocket(host: InetAddress?, port: Int): Socket =
      LanSocket().apply { connect(InetSocketAddress(host, port)) }
    override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket =
      def.createSocket(address, port, localAddress, localPort)
  }
}
