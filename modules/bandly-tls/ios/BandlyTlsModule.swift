import ExpoModulesCore
import Foundation

/// علامة للـ JS: شبكة React Native فيها معالج «تحدي الشهادة» (يركّبه BandlyLanTrust.m وقت التحميل)
public class BandlyTlsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BandlyTls")
    Function("lanTls") { () -> Bool in
      guard let cls = NSClassFromString("RCTHTTPRequestHandler") as? NSObject.Type else { return false }
      return cls.instancesRespond(to: NSSelectorFromString("URLSession:didReceiveChallenge:completionHandler:"))
    }
  }
}
