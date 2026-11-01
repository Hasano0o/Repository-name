// راوترات تفرض https بشهادة ذاتية (Huawei H112-370 من Three — ٣١ أكتوبر ٢٠٢٦: «A TLS error caused the secure connection to fail»).
//
// fetch في Expo SDK 57 هو fetch حق Expo نفسه (ExpoFetchModule — URLSession مندوبه URLSessionSessionDelegateProxy،
// والطلب ExpoURLSessionTask)، مو RCTHTTPRequestHandler حق React Native. بناء 1.1.1 ركّب المعالج على RN بس، فما اشتغل
// على الآيفون (١ نوفمبر: «الاتصال المشفّر فشل» مع H112-370). الحين نركّبه على الثلاثة — وقت التحميل وبعد ما يقلع التطبيق،
// قبل أول جلسة — دالة «تحدي الشهادة»: نقبل الشهادة غير الموثّقة **بس** لما العنوان محلي
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

typedef void (^BandlyDone)(NSURLSessionAuthChallengeDisposition, NSURLCredential *);

/// يضيف دالتي التحدي للكلاس (لو موجودة أصلاً class_addMethod ما يستبدلها) — يرجّع YES لو الكلاس موجود
static BOOL BandlyInstallOn(Class cls) {
  if (!cls) return NO;
  // مستوى الجلسة (تحدي الشهادة يجي هنا أول لو المندوب يدعمه)
  IMP i1 = imp_implementationWithBlock(^(id _self, NSURLSession *session, NSURLAuthenticationChallenge *ch, BandlyDone done) {
    BandlyHandle(ch, done);
  });
  class_addMethod(cls, @selector(URLSession:didReceiveChallenge:completionHandler:), i1, "v@:@@@?");
  // مستوى الطلب
  IMP i2 = imp_implementationWithBlock(^(id _self, NSURLSession *session, NSURLSessionTask *task, NSURLAuthenticationChallenge *ch, BandlyDone done) {
    BandlyHandle(ch, done);
  });
  class_addMethod(cls, @selector(URLSession:task:didReceiveChallenge:completionHandler:), i2, "v@:@@@@?");
  return YES;
}

static Class BandlyClass(NSArray<NSString *> *names) {
  for (NSString *n in names) { Class c = NSClassFromString(n); if (c) return c; }
  return nil;
}

static void BandlyInstallAll(void) {
  // Expo fetch (global fetch في SDK 57): مندوب الجلسة + مندوب الطلب (المندوب يسأل الطلب لو يدعم التحدي)
  BandlyInstallOn(BandlyClass(@[@"ExpoModulesCore.URLSessionSessionDelegateProxy", @"_TtC15ExpoModulesCore30URLSessionSessionDelegateProxy"]));
  BandlyInstallOn(BandlyClass(@[@"Expo.ExpoURLSessionTask", @"_TtC4Expo18ExpoURLSessionTask"]));
  // React Native (XMLHttpRequest والصور وغيرها)
  BandlyInstallOn(NSClassFromString(@"RCTHTTPRequestHandler"));
}

@interface BandlyLanTrust : NSObject
@end

@implementation BandlyLanTrust

+ (void)load {
  BandlyInstallAll();
  // كلاسات Swift ممكن ما تكون جاهزة وقت +load — نعيدها بعد ما يقلع التطبيق (قبل أول fetch؛ جلسة Expo تنبني أول طلب)
  [[NSNotificationCenter defaultCenter] addObserverForName:@"UIApplicationDidFinishLaunchingNotification"
                                                    object:nil queue:nil usingBlock:^(NSNotification *n) {
    BandlyInstallAll();
  }];
}

@end
