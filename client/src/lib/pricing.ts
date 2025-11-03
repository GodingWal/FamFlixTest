import type { SubscriptionPlan } from "@shared/subscriptions";

export interface PricingPlan {
  plan: SubscriptionPlan;
  name: string;
  priceMonthly: number;
  description: string;
  headline: string;
  features: string[];
  highlight?: boolean;
}

export const pricingPlans: PricingPlan[] = [
  {
    plan: "free",
    name: "Free",
    priceMonthly: 0,
    description: "Create and share core family stories with essential tools.",
    headline: "Get started at no cost",
    features: [
      "Up to 5 collaborative projects",
      "Basic AI story generation",
      "Standard voice cloning (1 voice)",
      "720p video exports",
    ],
  },
  {
    plan: "premium",
    name: "Premium",
    priceMonthly: 19.99,
    description: "Unlock advanced creative tools and higher quality output.",
    headline: "Best for creative families",
    features: [
      "Unlimited projects & stories",
      "Advanced AI voice studio (5 voices)",
      "1080p video exports with custom branding",
      "Priority processing and support",
    ],
    highlight: true,
  },
  {
    plan: "family_pro",
    name: "Family Pro",
    priceMonthly: 39.99,
    description: "Collaborate across extended families with premium features.",
    headline: "Everything for growing families",
    features: [
      "Unlimited shared family workspaces",
      "Studio-quality voice cloning (15 voices)",
      "4K HDR video exports & archival storage",
      "Early access to new AI storytelling tools",
    ],
  },
];

export const formatMonthlyPrice = (price: number) => {
  if (price === 0) {
    return "$0";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(price);
};

export const getPricingPlan = (plan: SubscriptionPlan): PricingPlan | undefined =>
  pricingPlans.find((tier) => tier.plan === plan);
