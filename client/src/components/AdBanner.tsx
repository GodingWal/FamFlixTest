import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";

const GOOGLE_AD_MANAGER_SRC = "https://securepubads.g.doubleclick.net/tag/js/gpt.js";
const DEFAULT_DAILY_CAP = 5;

let adScriptPromise: Promise<void> | null = null;
let isGoogletagInitialized = false;

declare global {
  interface Window {
    googletag?: any;
  }
}

interface AdPreferenceResponse {
  placementId: string;
  optOut: boolean;
  dailyCap: number;
  dailyImpressions: number;
  lastImpressionAt: string | null;
  frequencyCapReached: boolean;
}

interface AdBannerProps {
  placementId: string;
  className?: string;
  layout?: "inline" | "sidebar";
}

function loadAdScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }

  if (adScriptPromise) {
    return adScriptPromise;
  }

  adScriptPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${GOOGLE_AD_MANAGER_SRC}"]`
    );

    if (!window.googletag) {
      window.googletag = { cmd: [] };
    }

    if (existingScript) {
      if (existingScript.dataset.loaded === "true") {
        resolve();
        return;
      }

      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load ad script")), {
        once: true,
      });
      return;
    }

    const script = document.createElement("script");
    script.src = GOOGLE_AD_MANAGER_SRC;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Failed to load Google Ad Manager"));
    document.head.appendChild(script);
  });

  return adScriptPromise;
}

export function AdBanner({ placementId, className, layout = "inline" }: AdBannerProps) {
  const queryClient = useQueryClient();
  const [hasRecordedImpression, setHasRecordedImpression] = useState(false);
  const [isSlotRendering, setIsSlotRendering] = useState(false);
  const lastImpressionCountRef = useRef<number | undefined>(undefined);
  const recordInFlightRef = useRef(false);

  const slotElementId = useMemo(
    () => `ad-slot-${placementId.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    [placementId]
  );

  const { data, isLoading, isError } = useQuery<AdPreferenceResponse>({
    queryKey: ["ads", "preferences", placementId],
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/ads/preferences?placementId=${encodeURIComponent(placementId)}`
      );
      return response.json();
    },
    staleTime: 30 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });

  useEffect(() => {
    if (data?.dailyImpressions === undefined) {
      return;
    }

    if (
      lastImpressionCountRef.current !== undefined &&
      data.dailyImpressions < lastImpressionCountRef.current
    ) {
      setHasRecordedImpression(false);
    }

    lastImpressionCountRef.current = data.dailyImpressions;
  }, [data?.dailyImpressions]);

  const {
    mutate: mutatePreferences,
    isPending: isUpdatingPreferences,
  } = useMutation({
    mutationFn: async (variables: {
      optOut?: boolean;
      incrementImpression?: boolean;
      dailyCap?: number;
    }) => {
      const response = await apiRequest("POST", "/api/ads/preferences", {
        placementId,
        ...variables,
      });
      return response.json();
    },
    onSuccess: (updated: AdPreferenceResponse, variables) => {
      queryClient.setQueryData(["ads", "preferences", placementId], updated);
      if (variables.incrementImpression) {
        setHasRecordedImpression(true);
      }
      if (variables.optOut !== undefined) {
        setHasRecordedImpression(false);
      }
    },
    onError: (error) => {
      console.error("Ad preference update failed", error);
    },
  });

  const shouldDisplayAd = useMemo(() => {
    if (!data) {
      return false;
    }

    if (data.optOut || data.frequencyCapReached) {
      return false;
    }

    return true;
  }, [data]);

  useEffect(() => {
    if (!shouldDisplayAd) {
      setIsSlotRendering(false);
      return;
    }

    let cancelled = false;
    let impressionHandler: ((event: any) => void) | null = null;
    let renderHandler: ((event: any) => void) | null = null;

    const setupAdSlot = async () => {
      try {
        await loadAdScript();
        if (cancelled) {
          return;
        }

        const googletag = window.googletag;
        if (!googletag) {
          return;
        }

        googletag.cmd = googletag.cmd || [];
        googletag.cmd.push(() => {
          if (cancelled) {
            return;
          }

          const pubads = googletag.pubads();

          if (!isGoogletagInitialized) {
            pubads.enableSingleRequest();
            pubads.collapseEmptyDivs();
            googletag.enableServices();
            isGoogletagInitialized = true;
          }

          const existingSlot = pubads
            .getSlots()
            .find((slot: any) => slot.getSlotElementId?.() === slotElementId);

          const sizes =
            layout === "sidebar"
              ? [
                  [300, 600],
                  [300, 250],
                  [160, 600],
                  "fluid",
                ]
              : [
                  [728, 90],
                  [970, 250],
                  [320, 100],
                  [300, 250],
                  "fluid",
                ];

          const slot = existingSlot
            ? existingSlot
            : (() => {
                const newSlot = googletag.defineSlot(placementId, sizes, slotElementId);
                if (!newSlot) {
                  return null;
                }
                newSlot.addService(pubads);
                return newSlot;
              })();

          if (!slot) {
            setIsSlotRendering(false);
            return;
          }

          impressionHandler = (event: any) => {
            if (event.slot !== slot) {
              return;
            }

            if (hasRecordedImpression || recordInFlightRef.current) {
              return;
            }

            recordInFlightRef.current = true;
            mutatePreferences(
              { incrementImpression: true },
              {
                onSettled: () => {
                  recordInFlightRef.current = false;
                },
              }
            );
          };

          renderHandler = (event: any) => {
            if (event.slot === slot) {
              setIsSlotRendering(false);
            }
          };

          pubads.addEventListener("impressionViewable", impressionHandler);
          pubads.addEventListener("slotRenderEnded", renderHandler);

          setIsSlotRendering(true);

          if (existingSlot) {
            pubads.refresh([slot]);
          } else {
            googletag.display(slotElementId);
          }
        });
      } catch (error) {
        console.error(error);
      }
    };

    setupAdSlot();

    return () => {
      cancelled = true;

      if (typeof window === "undefined") {
        return;
      }

      const googletag = window.googletag;
      if (!googletag?.cmd) {
        return;
      }

      googletag.cmd.push(() => {
        const pubads = googletag.pubads();
        if (impressionHandler) {
          pubads.removeEventListener?.("impressionViewable", impressionHandler);
        }
        if (renderHandler) {
          pubads.removeEventListener?.("slotRenderEnded", renderHandler);
        }
      });
    };
  }, [
    hasRecordedImpression,
    layout,
    mutatePreferences,
    placementId,
    shouldDisplayAd,
    slotElementId,
  ]);

  const optOut = () => mutatePreferences({ optOut: true });
  const optIn = () => mutatePreferences({ optOut: false });

  const containerClass = cn(
    "rounded-xl border border-dashed border-primary/40 bg-primary/5 p-4 text-center shadow-sm",
    layout === "sidebar" ? "h-full" : "",
    className
  );

  const showManageLink = data && !isLoading && !isError;
  const hasOptedOut = !!data?.optOut;
  const reachedFrequencyCap = !!data?.frequencyCapReached;
  const dailyCap = data?.dailyCap ?? DEFAULT_DAILY_CAP;
  const impressions = data?.dailyImpressions ?? 0;

  return (
    <div className={containerClass} data-testid={`ad-banner-${placementId}`}>
      <span className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">
        Sponsored
      </span>

      {isLoading ? (
        <div className="mt-4 h-20 animate-pulse rounded-md bg-primary/10" />
      ) : isError ? (
        <p className="mt-4 text-xs text-muted-foreground">
          We couldn't load family-friendly promotions right now.
        </p>
      ) : shouldDisplayAd ? (
        <div className="mt-4 flex justify-center">
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-md bg-white",
              layout === "sidebar"
                ? "min-h-[250px]"
                : "min-h-[120px]"
            )}
          >
            {isSlotRendering && (
              <div className="absolute inset-0 flex items-center justify-center bg-muted/40 text-xs text-muted-foreground">
                Loading family-friendly content…
              </div>
            )}
            <div
              id={slotElementId}
              className={cn(
                "flex h-full w-full items-center justify-center text-muted-foreground/70",
                !isSlotRendering && "min-h-[1px]"
              )}
            />
          </div>
        </div>
      ) : hasOptedOut ? (
        <p className="mt-4 text-xs text-muted-foreground">
          You've opted out of promotional messages for this spot.
        </p>
      ) : (
        <p className="mt-4 text-xs text-muted-foreground">
          You've seen all {dailyCap} ads for today. Come back tomorrow for something new!
        </p>
      )}

      {showManageLink ? (
        <div className="mt-4 flex items-center justify-center gap-3 text-[11px] text-muted-foreground">
          <span>
            {reachedFrequencyCap
              ? `Daily limit reached (${impressions}/${dailyCap})`
              : `Daily limit: ${impressions}/${dailyCap}`}
          </span>
          <button
            type="button"
            className="font-medium text-primary hover:underline"
            onClick={hasOptedOut ? optIn : optOut}
            disabled={isUpdatingPreferences}
          >
            {hasOptedOut ? "Enable ads" : "Hide this ad"}
          </button>
        </div>
      ) : null}

      <p className="mt-3 text-[10px] text-muted-foreground/80">
        We limit impressions per day to keep experiences fun and family-friendly.
      </p>
    </div>
  );
}

export default AdBanner;
