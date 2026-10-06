package expo.modules.bandlycell

import android.app.Application
import android.content.Context
import expo.modules.core.interfaces.ApplicationLifecycleListener
import expo.modules.core.interfaces.Package

/** يركّب توجيه الراوتر عبر الواي فاي عند تشغيل التطبيق (قبل ما يبدأ React ويجهّز fetch) */
class BandlyCellPackage : Package {
  override fun createApplicationLifecycleListeners(context: Context?): List<ApplicationLifecycleListener> =
    listOf(object : ApplicationLifecycleListener {
      override fun onCreate(application: Application) {
        WifiRoute.install(application)
      }
    })
}
