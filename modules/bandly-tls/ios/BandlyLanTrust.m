// راوترات تفرض https بشهادة ذاتية (Huawei H112-370 من Three — ٣١ أكتوبر ٢٠٢٦: «A TLS error caused the secure connection to fail»).
//
// fetch في React Native يمر على RCTHTTPRequestHandler (مندوب NSURLSession). هنا نضيف له — وقت تحميل التطبيق،
// قبل أي جلسة — دالة «تحدي الشهادة»: نقبل الشهادة غير الموثّقة **بس** لما العنوان محلي
// (192.168.x / 10.x / 172.16-31.x / 169.254.x، أو اسم .local/.lan/.home/.internal، أو اسم بدون نقطة).
// أي عنوان ثاني (السيرفر، التحديثات، Cloudflare) = فحص النظام العادي بالضبط (PerformDefaultHandling).
// ما نلمس كلاس React بالاسم وقت الترجمة (NSClassFromString) — لو تغيّر في نسخة RN قادمة ما ينكسر البناء.

#import <Foundation/Foundation.h>
#import <objc/runtime.h>

static BOOL BandlyIsLocalHost(NSString *host) {
  if (host.length == 0) return NO;
  NSString *h = host.lowercaseString;
  // أسماء صفحات الراوترات (H112-370 من Three يحوّل لـ https://hirouter.net) — نفس ROUTER_NAMES في src/utils/host.ts
  if ([@[@"hirouter.net", @"homerouter.cpe", @"mediarouter.home", @"routerlogin.net", @"routerlogin.com", @"tplinkwifi.net", @"tplinklogin.net", @"tplinkmodem.net", @"tplinkrepeater.net", @"mwlogin.net", @"miwifi.com", @"router.asus.com", @"dlinkrouter.local"] containsObject:h]) return YES;
  NSArray<NSString *> *parts = [h componentsSeparatedByString:@"."];
  if (parts.count == 4) {
    BOOL numeric = YES;
    int o[4];
    for (int i = 0; i < 4; i++) {
      NSString *p = parts[i];
      if (p.length == 0 || p.length > 3 ||
          [p rangeOfCharacterFromSet:[[NSCharacterSet decimalDigitCharacterSet] invertedSet]].location != NSNotFound) {
        numeric = NO; break;
      }
      o[i] = p.intValue;
    }
    if (numeric) {
      if (o[0] == 10) return YES;
      if (o[0] == 192 && o[1] == 168) return YES;
      if (o[0] == 169 && o[1] == 254) return YES;
      if (o[0] == 172 && o[1] >= 16 && o[1] <= 31) return YES;
      return NO;
    }
  }
  for (NSString *suffix in @[@".local", @".lan", @".home", @".internal", @".cpe", @".router", @".box", @".gateway"]) {
    if ([h hasSuffix:suffix]) return YES;
  }
  return [h rangeOfString:@"."].location == NSNotFound && [h rangeOfString:@":"].location == NSNotFound;
}

static void BandlyHandle(NSURLAuthenticationChallenge *challenge,
                         void (^completion)(NSURLSessionAuthChallengeDisposition, NSURLCredential *)) {
  NSURLProtectionSpace *space = challenge.protectionSpace;
  if ([space.authenticationMethod isEqualToString:NSURLAuthenticationMethodServerTrust] &&
      space.serverTrust != NULL && BandlyIsLocalHost(space.host)) {
    completion(NSURLSessionAuthChallengeUseCredential, [NSURLCredential credentialForTrust:space.serverTrust]);
    return;
  }
  completion(NSURLSessionAuthChallengePerformDefaultHandling, nil);
}

@interface BandlyLanTrust : NSObject
@end

@implementation BandlyLanTrust

+ (void)load {
  Class cls = NSClassFromString(@"RCTHTTPRequestHandler");
  if (!cls) return;

  // مستوى الجلسة (تحدي الشهادة يجي هنا أول)
  SEL s1 = @selector(URLSession:didReceiveChallenge:completionHandler:);
  IMP i1 = imp_implementationWithBlock(^(id _self, NSURLSession *session, NSURLAuthenticationChallenge *ch,
                                         void (^done)(NSURLSessionAuthChallengeDisposition, NSURLCredential *)) {
    BandlyHandle(ch, done);
  });
  class_addMethod(cls, s1, i1, "v@:@@@?");

  // مستوى الطلب (لو النظام سأل هنا)
  SEL s2 = @selector(URLSession:task:didReceiveChallenge:completionHandler:);
  IMP i2 = imp_implementationWithBlock(^(id _self, NSURLSession *session, NSURLSessionTask *task, NSURLAuthenticationChallenge *ch,
                                         void (^done)(NSURLSessionAuthChallengeDisposition, NSURLCredential *)) {
    BandlyHandle(ch, done);
  });
  class_addMethod(cls, s2, i2, "v@:@@@@?");
  // class_addMethod ما يستبدل دالة موجودة — لو نسخة RN قادمة فيها معالج، يبقى معالجها
}

@end
