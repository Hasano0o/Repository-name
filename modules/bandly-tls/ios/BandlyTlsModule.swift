import ExpoModulesCore
import Foundation

/// علامة للـ JS: fetch حق Expo (اللي يستخدمه التطبيق) فيه معالج «تحدي الشهادة» — يركّبه BandlyLanTrust.m
public class BandlyTlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BandlyTls")
    Function("lanTls") { () -> Bool in
      let sel = NSSelectorFromString("URLSession:didReceiveChallenge:completionHandler:")
      for name in ["ExpoModulesCore.URLSessionSessionDelegateProxy", "_TtC15ExpoModulesCore30URLSessionSessionDelegateProxy"] {
        if let cls = NSClassFromString(name) as? NSObject.Type { return cls.instancesRespond(to: sel) }
      }
      return false
    }
  }
}
