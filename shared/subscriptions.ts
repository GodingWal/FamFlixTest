export const subscriptionPlans = ["free", "premium", "family_pro"] as const satisfies readonly [string, ...string[]];

export type SubscriptionPlan = typeof subscriptionPlans[number];
