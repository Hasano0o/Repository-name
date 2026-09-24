/**
 * Router Lab — Types — PHASE 5A
 *
 * نموذج بيانات لمختبر الراوتر الوهمي.
 * Pure data — لا I/O، لا شبكة، لا تخزين.
 * Deterministic — نفس profile + request → نفس response.
 *
 * ملاحظة معمارية:
 *   Mock Router لا يُستخدم كـ Driver بديل.
 *   يُستخدم فقط لتغذية مسار Discovery الحقيقي
 *   (safeDiscoveryFetch → policy → parser → sanitize → evidence).
 */

/** Discovery GET-only — صراحة في النوع لمنع أي POST */
export type MockHttpMethod = 'GET';

export interface MockHttpResponse {
  /** GET فقط — Discovery never uses other methods */
  readonly method: MockHttpMethod;
  /** مسار مطلق يبدأ بـ / */
  readonly path: string;
  readonly status: number;
  readonly contentType: string;
  readonly body: string;
  /** Headers اختيارية (آمنة فقط) — مثل location لـ 302 */
  readonly headers?: Readonly<Record<string, string>>;
}

export interface MockRouterProfile {
  readonly id: string;
  readonly vendor: string;
  readonly model: string;
  /** وصف قصير اختياري */
  readonly description?: string;
  /**
   * بادئة اختيارية — تُضاف قبل كل path.
   * محفوظة للمستقبل — معظم profiles تتركها undefined.
   */
  readonly basePath?: string;
  /** صفحات HTML/ثابتة */
  readonly pages: readonly MockHttpResponse[];
  /** نقاط API (JSON/XML/نص) */
  readonly endpoints: readonly MockHttpResponse[];

  /**
   * تصنيف الواقعية — PHASE 5F.
   * - 'synthetic-basic': بيانات مبسّطة
   * - 'synthetic-realistic': بنية قريبة من أجهزة حقيقية
   * غياب الحقل = profile قديم من 5A/5B.
   */
  readonly realism?: 'synthetic-basic' | 'synthetic-realistic';

  /**
   * إفصاح صريح عن مصدر البيانات.
   * لا يُعتبر دليلًا على صحة المحتوى.
   */
  readonly disclosure?: string;
}

export type MockLookupReason = 'NOT_FOUND';

export interface MockLookupResult {
  readonly matched: boolean;
  readonly response?: Readonly<MockHttpResponse>;
  readonly reason?: MockLookupReason;
}
