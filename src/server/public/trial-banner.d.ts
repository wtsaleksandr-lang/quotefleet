/**
 * Type declaration for the browser UMD module trial-banner.js so the vitest
 * suite (a .ts file) can import the pure logic without tripping `pnpm
 * typecheck` (TS7016 — no declaration file). Kept in lockstep with the .js.
 */
export type TrialBannerStatus = 'trial' | 'trial_expired' | 'paid' | 'unknown' | null | undefined;

export interface TrialBannerViewOpts {
  trialStatus?: TrialBannerStatus;
  daysLeft?: number;
  billingConfigured?: boolean;
  paymentPastDue?: boolean;
}

export interface TrialBannerView {
  show: boolean;
  variant: 'trial' | 'expired' | 'payment_issue' | null;
  urgent: boolean;
  headline: string | null;
  ctaShown: boolean;
  ctaLabel: string | null;
}

export function daysLeftFrom(trialEndsAt: string | number | Date | null | undefined, now?: string | number | Date): number;
export function trialHeadline(daysLeft: number): string;
export function computeTrialBannerView(opts: TrialBannerViewOpts): TrialBannerView;

declare const _default: {
  daysLeftFrom: typeof daysLeftFrom;
  trialHeadline: typeof trialHeadline;
  computeTrialBannerView: typeof computeTrialBannerView;
};
export default _default;
