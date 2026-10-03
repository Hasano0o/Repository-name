package expo.modules.bandlycell

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.telephony.CellInfo
import android.telephony.CellInfoLte
import android.telephony.CellInfoNr
import android.telephony.CellIdentityNr
import android.telephony.CellSignalStrengthNr
import android.telephony.TelephonyManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.Executor
import java.util.concurrent.atomic.AtomicBoolean

/**
 * يقرأ إشارة الشبكة من شريحة الجهاز نفسه (4G/5G) عن طريق TelephonyManager.
 * مفيد للأجهزة اللي تشتغل بنظام أندرويد (هب 5G منزلي، أو الجوال نفسه).
 */
class BandlyCellModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw CodedException("NO_CONTEXT", "Context غير متوفر", null)

  private fun tm(): TelephonyManager =
    ctx.getSystemService(Context.TELEPHONY_SERVICE) as TelephonyManager

  private fun granted(p: String) =
    ctx.checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

  private fun hasLocation() =
    granted(Manifest.permission.ACCESS_FINE_LOCATION) || granted(Manifest.permission.ACCESS_COARSE_LOCATION)

  /** CellInfo.UNAVAILABLE = Integer.MAX_VALUE — نحوّله لـ null */
  private fun v(x: Int): Int? = if (x == Int.MAX_VALUE || x == Int.MIN_VALUE) null else x
  private fun vl(x: Long): Long? = if (x == Long.MAX_VALUE || x == Long.MIN_VALUE) null else x

  override fun definition() = ModuleDefinition {
    Name("BandlyCell")

    Function("isSupported") {
      ctx.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    }

    Function("hasPermission") { hasLocation() }

    Function("deviceInfo") {
      val t = tm()
      mapOf(
        "manufacturer" to Build.MANUFACTURER,
        "model" to Build.MODEL,
        "android" to Build.VERSION.RELEASE,
        "sdk" to Build.VERSION.SDK_INT,
        "operator" to (t.networkOperatorName ?: ""),
        "simOperator" to (t.simOperatorName ?: ""),
        "simState" to t.simState,
      )
    }

    /** حالة الخدمة: المشغّل + عروض النطاقات (عدد النواقل المدموجة) + نص الحالة الخام */
    Function("serviceInfo") {
      val t = tm()
      val out = mutableMapOf<String, Any?>(
        "operator" to (t.networkOperatorName ?: ""),
        "operatorNumeric" to (t.networkOperator ?: ""),
      )
      try {
        if (Build.VERSION.SDK_INT >= 26) {
          val ss = t.serviceState
          if (ss != null) {
            out["state"] = ss.state
            if (Build.VERSION.SDK_INT >= 28) out["bandwidths"] = ss.cellBandwidths.toList()
            out["raw"] = ss.toString()
          }
        }
      } catch (ignored: SecurityException) {
        out["denied"] = true
      } catch (ignored: Throwable) {}
      out
    }

    /** كل الأبراج اللي يشوفها المودم (الحالي + المجاورة) */
    AsyncFunction("getCells") { promise: Promise ->
      if (!hasLocation()) {
        promise.reject(CodedException("NO_PERMISSION", "صلاحية الموقع مطلوبة لقراءة الأبراج", null))
        return@AsyncFunction
      }
      val t = tm()
      val done = AtomicBoolean(false)
      fun finish(list: List<CellInfo>?) {
        if (!done.compareAndSet(false, true)) return
        try {
          promise.resolve((list ?: emptyList()).mapNotNull { toMap(it) })
        } catch (e: Throwable) {
          promise.reject(CodedException("READ_FAILED", e.message ?: "تعذر قراءة الأبراج", e))
        }
      }
      try {
        if (Build.VERSION.SDK_INT >= 29) {
          // نطلب قراءة جديدة من المودم، ولو تأخرت نرجع آخر قراءة محفوظة
          val main = Handler(Looper.getMainLooper())
          val exec = Executor { r -> main.post(r) }
          t.requestCellInfoUpdate(exec, object : TelephonyManager.CellInfoCallback() {
            override fun onCellInfo(cellInfo: List<CellInfo>) { finish(cellInfo) }
            override fun onError(errorCode: Int, detail: Throwable?) {
              finish(try { t.allCellInfo } catch (ignored: Throwable) { null })
            }
          })
          main.postDelayed({ finish(try { t.allCellInfo } catch (ignored: Throwable) { null }) }, 2500)
        } else {
          finish(t.allCellInfo)
        }
      } catch (e: SecurityException) {
        if (done.compareAndSet(false, true)) {
          promise.reject(CodedException("NO_PERMISSION", "صلاحية الموقع مطلوبة لقراءة الأبراج", e))
        }
      } catch (e: Throwable) {
        if (done.compareAndSet(false, true)) {
          promise.reject(CodedException("READ_FAILED", e.message ?: "تعذر قراءة الأبراج", e))
        }
      }
    }
  }

  private fun toMap(c: CellInfo): Map<String, Any?>? {
    if (c is CellInfoLte) {
      val id = c.cellIdentity
      val sg = c.cellSignalStrength
      val m = mutableMapOf<String, Any?>(
        "tech" to "LTE",
        "registered" to c.isRegistered,
        "ci" to v(id.ci),
        "pci" to v(id.pci),
        "tac" to v(id.tac),
        "earfcn" to v(id.earfcn),
        "rsrp" to v(sg.rsrp),
        "rsrq" to v(sg.rsrq),
        "ta" to v(sg.timingAdvance),
        "dbm" to v(sg.dbm),
        "level" to sg.level,
      )
      if (Build.VERSION.SDK_INT >= 26) {
        m["rssnr"] = v(sg.rssnr)
        m["cqi"] = v(sg.cqi)
      }
      if (Build.VERSION.SDK_INT >= 28) {
        m["bandwidth"] = v(id.bandwidth)
        m["mcc"] = id.mccString
        m["mnc"] = id.mncString
      }
      if (Build.VERSION.SDK_INT >= 29) m["rssi"] = v(sg.rssi)
      if (Build.VERSION.SDK_INT >= 30) m["bands"] = id.bands.toList()
      return m
    }
    if (Build.VERSION.SDK_INT >= 29 && c is CellInfoNr) {
      val id = c.cellIdentity as CellIdentityNr
      val sg = c.cellSignalStrength as CellSignalStrengthNr
      val m = mutableMapOf<String, Any?>(
        "tech" to "NR",
        "registered" to c.isRegistered,
        "nci" to vl(id.nci)?.toString(),
        "pci" to v(id.pci),
        "tac" to v(id.tac),
        "arfcn" to v(id.nrarfcn),
        "rsrp" to v(sg.ssRsrp),
        "rsrq" to v(sg.ssRsrq),
        "sinr" to v(sg.ssSinr),
        "level" to sg.level,
        "mcc" to id.mccString,
        "mnc" to id.mncString,
      )
      if (Build.VERSION.SDK_INT >= 30) m["bands"] = id.bands.toList()
      return m
    }
    return null
  }
}
