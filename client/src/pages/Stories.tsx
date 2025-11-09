import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Navigation } from "@/components/Navigation";
import AdBanner from "@/components/AdBanner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import Seo, { BASE_URL } from "@/components/Seo";
import { cn } from "@/lib/utils";

type StoryCategory =
  | "BEDTIME"
  | "CLASSIC"
  | "FAIRYTALE"
  | "ADVENTURE"
  | "EDUCATIONAL"
  | "CUSTOM"
  | string;

interface StorySummary {
  id: string;
  slug: string;
  title: string;
  author: string | null;
  category: StoryCategory;
  rights: string;
  tags: string[];
  coverUrl: string | null;
  summary: string | null;
  ageRange: {
    min: number | null;
    max: number | null;
  };
  durationMin: number | null;
  metadata: Record<string, unknown>;
  createdAt: string | null;
  updatedAt: string | null;
}

interface VoiceProfile {
  id: string;
  name: string;
  displayName?: string;
  status?: string;
}

interface StorySection {
  id: string;
  index: number;
  title: string | null;
  wordCount: number;
  text?: string;
}

type StoryAudioStatus = "PENDING" | "QUEUED" | "PROCESSING" | "COMPLETE" | "ERROR" | string;

interface StoryAudioEntry {
  status: StoryAudioStatus;
  audioUrl: string | null;
  durationSec: number | null;
  checksum: string | null;
  transcript: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string | null;
}

interface StoryDetailResponse extends StorySummary {
  content?: string;
  sections: StorySection[];
}

interface StoryAudioSection extends StorySection {
  audio: StoryAudioEntry;
}

interface StoryAudioResponse {
  story: StorySummary;
  voice: {
    id: string;
    displayName?: string;
  };
  sections: StoryAudioSection[];
}

interface StoryListResponse {
  total: number;
  stories: StorySummary[];
}

interface ReadResponse {
  ready: boolean;
  jobId: string | null;
  state?: string;
  progress?: number;
  story: {
    id: string;
    slug: string;
    title: string;
  };
  voice: {
    id: string;
    displayName?: string;
  };
  sections?: StoryAudioSection[];
}

interface StoryJobStatus {
  id: string;
  state: string;
  progress: number;
  attempts: number;
  data: {
    storyId: string;
    voiceId: string;
  };
  failedReason: string | null;
  result: unknown;
  timestamp: {
    createdAt: string | null;
    finishedAt: string | null;
  };
}

interface ActiveJob {
  jobId: string;
  slug: string;
  voiceId: string;
}

const ACTIVE_JOB_STORAGE_KEY = "famflix-story-active-job";

const EMPTY_AUDIO_ENTRY: StoryAudioEntry = {
  status: "PENDING",
  audioUrl: null,
  durationSec: null,
  checksum: null,
  transcript: null,
  error: null,
  metadata: {},
  startedAt: null,
  completedAt: null,
  updatedAt: null,
};

const STATUS_BADGE_CLASS: Record<StoryAudioStatus, string> = {
  PENDING: "bg-slate-800 text-slate-200 border border-slate-600",
  QUEUED: "bg-amber-500/20 text-amber-200 border border-amber-500/40",
  PROCESSING: "bg-sky-500/20 text-sky-100 border border-sky-500/50",
  COMPLETE: "bg-emerald-500/20 text-emerald-100 border border-emerald-500/50",
  ERROR: "bg-rose-500/20 text-rose-100 border border-rose-500/40",
};

const JOB_STATE_LABEL: Record<string, string> = {
  waiting: "Waiting in queue",
  delayed: "Delayed",
  active: "Generating audio",
  completed: "Completed",
  failed: "Failed",
  paused: "Paused",
  stuck: "Stuck",
  waitingChildren: "Waiting on subtasks",
};

const jobStateBadge = (state: string) => {
  switch (state) {
    case "completed":
      return "bg-emerald-500/20 text-emerald-100 border border-emerald-500/40";
    case "active":
      return "bg-sky-500/20 text-sky-100 border border-sky-500/40";
    case "failed":
      return "bg-rose-500/20 text-rose-100 border border-rose-500/40";
    case "waiting":
    case "waitingChildren":
      return "bg-amber-500/20 text-amber-100 border border-amber-500/40";
    default:
      return "bg-slate-800 text-slate-200 border border-slate-600";
  }
};

const formatMinutes = (minutes: number | null | undefined) => {
  if (!minutes || Number.isNaN(minutes)) {
    return null;
  }
  if (minutes < 1) {
    return "<1 minute";
  }
  if (minutes < 60) {
    return `${Math.round(minutes)} minute${minutes >= 1.5 ? "s" : ""}`;
  }
  const hours = minutes / 60;
  if (hours < 3) {
    return `${hours.toFixed(1)} hours`;
  }
  return `${Math.round(hours)} hours`;
};

export default function Stories() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedVoiceProfile, setSelectedVoiceProfile] = useState<string | null>(
    null
  );
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [jobStatus, setJobStatus] = useState<StoryJobStatus | null>(null);
  const [isPlayAll, setIsPlayAll] = useState(false);
  const [playIndex, setPlayIndex] = useState<number>(0);
  const playAllAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const cached = window.sessionStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached) as ActiveJob;
        if (parsed?.jobId && parsed?.slug && parsed?.voiceId) {
          setActiveJob(parsed);
        }
      }
    } catch {
      // Ignore malformed cache
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (activeJob) {
      window.sessionStorage.setItem(ACTIVE_JOB_STORAGE_KEY, JSON.stringify(activeJob));
    } else {
      window.sessionStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
    }
  }, [activeJob]);

  const {
    data: storiesResponse,
    isLoading: storiesLoading,
    isError: storiesError,
  } = useQuery<StoryListResponse>({
    queryKey: ["story-catalog"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/stories");
      return response.json();
    },
  });

  const stories = storiesResponse?.stories ?? [];

  const {
    data: voiceProfiles = [],
    isLoading: voicesLoading,
  } = useQuery<VoiceProfile[]>({
    queryKey: ["voice-profiles"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/voice-profiles");
      return response.json();
    },
  });

  useEffect(() => {
    if (!selectedVoiceProfile && voiceProfiles.length > 0) {
      setSelectedVoiceProfile(voiceProfiles[0].id);
    }
  }, [voiceProfiles, selectedVoiceProfile]);

  useEffect(() => {
    if (!selectedSlug && stories.length > 0) {
      setSelectedSlug(stories[0].slug);
    }
  }, [stories, selectedSlug]);

  const selectedVoice = useMemo(
    () => voiceProfiles.find((profile) => profile.id === selectedVoiceProfile) ?? null,
    [voiceProfiles, selectedVoiceProfile]
  );

  const readyVoiceCount = useMemo(
    () =>
      voiceProfiles.filter(
        (profile) => !profile.status || profile.status === "ready"
      ).length,
    [voiceProfiles]
  );

  const totalStories = storiesResponse?.total ?? stories.length;

  const categories = useMemo(
    () =>
      Array.from(new Set(stories.map((story) => story.category || "UNCATEGORIZED"))).sort(
        (a, b) => a.localeCompare(b)
      ),
    [stories]
  );

  const filteredStories = useMemo(() => {
    if (categoryFilter === "ALL") {
      return stories;
    }
    return stories.filter(
      (story) =>
        (story.category || "UNCATEGORIZED").toUpperCase() === categoryFilter.toUpperCase()
    );
  }, [stories, categoryFilter]);

  const selectedStorySummary = useMemo(
    () => stories.find((story) => story.slug === selectedSlug) ?? null,
    [stories, selectedSlug]
  );

  const {
    data: storyDetail,
    isLoading: detailLoading,
  } = useQuery<StoryDetailResponse>({
    queryKey: ["story-detail", selectedSlug],
    queryFn: async () => {
      const response = await apiRequest("GET", `/api/stories/${selectedSlug}`);
      return response.json();
    },
    enabled: Boolean(selectedSlug),
  });

  const {
    data: storyAudioData,
    isFetching: audioFetching,
    refetch: refetchStoryAudio,
  } = useQuery<StoryAudioResponse>({
    queryKey: ["story-audio", selectedSlug, selectedVoiceProfile],
    queryFn: async () => {
      const response = await apiRequest(
        "GET",
        `/api/stories/${selectedSlug}/audio?voiceId=${encodeURIComponent(
          selectedVoiceProfile ?? ""
        )}`
      );
      return response.json();
    },
    enabled: Boolean(selectedSlug && selectedVoiceProfile),
  });

  useEffect(() => {
    if (!activeJob) {
      setJobStatus(null);
      return;
    }

    let isCancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const res = await apiRequest("GET", `/api/jobs/${activeJob.jobId}`);
        const data: StoryJobStatus = await res.json();
        if (isCancelled) {
          return;
        }
        setJobStatus(data);

        if (data.state === "completed") {
          toast({
            title: "Story narration ready",
            description: "All sections have completed synthesis.",
          });
          queryClient.invalidateQueries({
            queryKey: ["story-audio", activeJob.slug, activeJob.voiceId],
          });
          setActiveJob(null);
          return;
        }

        if (data.state === "failed") {
          toast({
            title: "Narration failed",
            description: data.failedReason ?? "We could not complete the narration job.",
            variant: "destructive",
          });
          setActiveJob(null);
          return;
        }

        timeoutId = setTimeout(poll, 3000);
      } catch (error: any) {
        if (isCancelled) {
          return;
        }
        console.error("Failed to poll story job", error);
        timeoutId = setTimeout(poll, 5000);
      }
    };

    poll();

    return () => {
      isCancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [activeJob, queryClient]);

  useEffect(() => {
    if (categoryFilter !== "ALL" && filteredStories.length === 0 && stories.length > 0) {
      setCategoryFilter("ALL");
    }
  }, [filteredStories.length, stories.length, categoryFilter]);

  const mergedSections: StoryAudioSection[] = useMemo(() => {
    const baseSections: (StorySection & { audio?: StoryAudioEntry })[] =
      storyDetail?.sections ??
      storyAudioData?.sections ??
      [];

    const audioLookup = new Map(
      (storyAudioData?.sections ?? []).map((section) => [section.id, section.audio])
    );

    if (storyAudioData?.sections && storyDetail?.sections) {
      // ensure we have consistent ordering from detail response
      return storyDetail.sections.map((section) => ({
        ...section,
        audio: audioLookup.get(section.id) ?? EMPTY_AUDIO_ENTRY,
      }));
    }

    return baseSections.map((section) => ({
      ...section,
      audio: section.audio ?? audioLookup.get(section.id) ?? EMPTY_AUDIO_ENTRY,
    }));
  }, [storyDetail, storyAudioData]);

  const playableSections = useMemo(
    () => mergedSections.filter((s) => Boolean(s.audio?.audioUrl)),
    [mergedSections]
  );

  // Reset "Play All" when story or voice changes
  useEffect(() => {
    setIsPlayAll(false);
    setPlayIndex(0);
    if (playAllAudioRef.current) {
      playAllAudioRef.current.pause();
      playAllAudioRef.current.src = "";
    }
  }, [selectedSlug, selectedVoiceProfile]);

  // When Play All is toggled on, (re)start from current playIndex
  useEffect(() => {
    const audioEl = playAllAudioRef.current;
    if (!audioEl) return;
    if (!isPlayAll) return;
    const current = playableSections[playIndex];
    if (!current?.audio?.audioUrl) return;
    if (audioEl.src !== new URL(current.audio.audioUrl, window.location.origin).toString()) {
      audioEl.src = current.audio.audioUrl;
    }
    audioEl.play().catch(() => {
      // Autoplay might be blocked; keep controls visible for manual play
    });
  }, [isPlayAll, playIndex, playableSections]);

  const nextSection = () => {
    setPlayIndex((idx) => {
      const next = idx + 1;
      if (next >= playableSections.length) {
        setIsPlayAll(false);
        return idx;
      }
      return next;
    });
  };

  const prevSection = () => {
    setPlayIndex((idx) => Math.max(0, idx - 1));
  };

  const handlePlayAllToggle = () => {
    if (playableSections.length === 0) return;
    if (!isPlayAll) {
      // Start from first incomplete or current index
      setPlayIndex((idx) => (idx < playableSections.length ? idx : 0));
      setIsPlayAll(true);
    } else {
      setIsPlayAll(false);
      playAllAudioRef.current?.pause();
    }
  };

  const requestNarration = useMutation<ReadResponse, unknown, { force?: boolean }>({
    mutationFn: async ({ force }) => {
      if (!selectedSlug || !selectedVoiceProfile) {
        throw new Error("Select a story and voice profile first.");
      }
      const response = await apiRequest("POST", `/api/stories/${selectedSlug}/read`, {
        voiceId: selectedVoiceProfile,
        force,
      });
      return response.json();
    },
    onSuccess: (data) => {
      if (data.ready) {
        toast({
          title: "Narration ready",
          description: "We found completed sections for this story and voice.",
        });
        queryClient.invalidateQueries({
          queryKey: ["story-audio", data.story.slug, selectedVoiceProfile],
        });
        setActiveJob(null);
        setJobStatus(null);
        refetchStoryAudio();
        return;
      }

      if (!data.jobId) {
        toast({
          title: "Narration requested",
          description: "We queued this story for processing.",
        });
        return;
      }

      toast({
        title: "Narration queued",
        description:
          "We'll keep you posted as each section completes. You can stay on this page or come back later.",
      });
      setActiveJob({
        jobId: data.jobId,
        slug: data.story.slug,
        voiceId: selectedVoiceProfile!,
      });
      setJobStatus((prev) => ({
        id: data.jobId!,
        state: data.state ?? prev?.state ?? "waiting",
        progress: data.progress ?? prev?.progress ?? 0,
        attempts: prev?.attempts ?? 0,
        data: {
          storyId: data.story.id,
          voiceId: selectedVoiceProfile!,
        },
        failedReason: null,
        result: null,
        timestamp: prev?.timestamp ?? {
          createdAt: new Date().toISOString(),
          finishedAt: null,
        },
      }));
    },
    onError: (error) => {
      const message =
        error && typeof error === "object" && "message" in error
          ? String((error as Error).message)
          : "We couldn't start narration. Please try again.";

      toast({
        title: "Narration failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleNarrate = (force?: boolean) => {
    if (!selectedVoiceProfile) {
      toast({
        title: "Select a voice",
        description: "Choose a voice profile before generating narration.",
        variant: "destructive",
      });
      return;
    }

    if (!selectedVoice || (selectedVoice.status && selectedVoice.status !== "ready")) {
      toast({
        title: "Voice not ready",
        description: "Pick a ready voice profile before generating narration.",
        variant: "destructive",
      });
      return;
    }

    requestNarration.mutate({ force });
  };

  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: [
      {
        "@type": "Question",
        name: "What are FamFlix Stories?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Stories are curated, age-appropriate scripts that families can personalize with AI voices and turn into narrated experiences inside FamFlix.",
        },
      },
      {
        "@type": "Question",
        name: "How do I generate narration for a story?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Choose your favorite voice profile, select a story, and click request narration. FamFlix will create an AI-read performance and notify you when it is ready.",
        },
      },
      {
        "@type": "Question",
        name: "Can I switch between different AI voices?",
        acceptedAnswer: {
          "@type": "Answer",
          text: "Absolutely. You can assign any approved family voice profile to a story and regenerate narration whenever you need a new performance.",
        },
      },
    ],
  } as const;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title="Discover AI-narrated family stories"
        description="Browse curated FamFlix stories, pair them with cloned family voices, and request immersive narrations in seconds."
        canonical={`${BASE_URL}/stories`}
        openGraph={{
          type: "website",
          url: `${BASE_URL}/stories`,
          title: "Discover AI-narrated family stories | FamFlix",
          description:
            "Browse curated FamFlix stories, pair them with cloned family voices, and request immersive narrations in seconds.",
        }}
        twitter={{
          title: "Discover AI-narrated family stories | FamFlix",
          description:
            "Explore ready-made FamFlix story scripts and instantly generate narrated performances with your family's AI voices.",
        }}
        jsonLd={faqSchema}
      />
      <Navigation />
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/15 via-transparent to-transparent" />
        <div className="container relative z-10 mx-auto px-4 pt-24 pb-10">
          <div className="space-y-10">
            <section className="rounded-3xl border border-border/60 bg-card/80 px-6 py-8 shadow-lg backdrop-blur">
              <div className="grid gap-6 md:grid-cols-[1.3fr_minmax(0,1fr)]">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
                    Story Studio
                  </p>
                  <h1 className="mt-2 text-4xl font-semibold text-foreground">Family Stories</h1>
                  <p className="mt-3 text-muted-foreground leading-relaxed">
                    Browse curated bedtime adventures, pair them with a cherished family voice, and let
                    FamFlix narrate the magic while you keep creating.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/80 bg-background/70 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Stories ready</p>
                    <p className="mt-1 text-3xl font-bold text-foreground">{totalStories || 0}</p>
                    <p className="text-sm text-muted-foreground">Hand-picked scripts</p>
                  </div>
                  <div className="rounded-2xl border border-border/80 bg-background/70 p-4 shadow-sm">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Ready voices</p>
                    <p className="mt-1 text-3xl font-bold text-foreground">{readyVoiceCount}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedVoice?.displayName ?? selectedVoice?.name) || "Select a voice"}
                    </p>
                  </div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button className="px-6" asChild>
                  <Link href="/stories/create">
                    <i className="fas fa-pen-nib mr-2" />
                    Create new story
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <a href="#story-library" className="flex items-center gap-2 text-sm">
                    <i className="fas fa-book-open" />
                    Browse library
                  </a>
                </Button>
              </div>
            </section>

            <div
              id="story-library"
              className="grid items-start gap-6 lg:grid-cols-[360px,minmax(0,1fr)]"
            >
              <div className="space-y-6">
                <Card className="rounded-2xl border border-border/80 bg-card/90 shadow-sm">
                  <CardHeader className="space-y-1">
                    <CardTitle className="text-lg">Narration voice</CardTitle>
                    <CardDescription>
                      Choose which cloned voice will bring each story to life.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {voicesLoading ? (
                      <Skeleton className="h-10 w-full" />
                    ) : voiceProfiles.length > 0 ? (
                      <Select
                        value={selectedVoiceProfile ?? undefined}
                        onValueChange={setSelectedVoiceProfile}
                      >
                        <SelectTrigger className="h-11 rounded-xl">
                          <SelectValue placeholder="Select a voice" />
                        </SelectTrigger>
                        <SelectContent>
                          {voiceProfiles.map((profile) => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {(profile.displayName ?? profile.name) || profile.name}
                              {profile.status && profile.status !== "ready"
                                ? ` · ${profile.status}`
                                : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No voice profiles found. Visit the Voice Cloning studio to create one.
                      </p>
                    )}
                    {user?.plan === "free" && (
                      <AdBanner placementId="stories-sidebar" layout="sidebar" />
                    )}
                  </CardContent>
                </Card>

                <Card className="rounded-2xl border border-border/80 bg-card/90 shadow-sm">
                  <CardHeader className="space-y-1">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-lg">Story library</CardTitle>
                      <Badge variant="outline" className="bg-secondary text-secondary-foreground">
                        {totalStories || 0} stories
                      </Badge>
                    </div>
                    <CardDescription>
                      Filter by category and pick a script to preview and narrate.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {storiesLoading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-24 w-full" />
                        <Skeleton className="h-24 w-full" />
                      </div>
                    ) : storiesError ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                        We couldn't load stories right now. Please try again later.
                      </div>
                    ) : stories.length === 0 ? (
                      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center text-muted-foreground">
                        No stories are available yet. Check back soon!
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <Select
                          value={categoryFilter}
                          onValueChange={(value) => setCategoryFilter(value)}
                        >
                          <SelectTrigger className="h-11 rounded-xl">
                            <SelectValue placeholder="Filter by category" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="ALL">All categories</SelectItem>
                            {categories.map((category) => (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="max-h-[60vh] space-y-3 overflow-y-auto pr-1">
                          {filteredStories.map((story) => {
                            const durationLabel = formatMinutes(story.durationMin);
                            const isSelected = story.slug === selectedSlug;
                            return (
                              <button
                                type="button"
                                key={story.id}
                                onClick={() => setSelectedSlug(story.slug)}
                                className={cn(
                                  "w-full rounded-2xl border border-border/80 bg-background/80 p-4 text-left transition hover:border-primary/50 hover:bg-primary/5",
                                  isSelected && "border-primary/60 bg-primary/5 shadow-sm"
                                )}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="text-lg font-semibold text-foreground">{story.title}</h3>
                                  {durationLabel && (
                                    <span className="text-xs text-muted-foreground">{durationLabel}</span>
                                  )}
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                  <span className="font-medium text-foreground/70">{story.category}</span>
                                  {story.ageRange?.min !== null && story.ageRange?.max !== null && (
                                    <span>
                                      Ages {story.ageRange.min}–{story.ageRange.max}
                                    </span>
                                  )}
                                  {story.tags?.slice(0, 3).map((tag) => (
                                    <span key={tag} className="rounded-full bg-secondary/30 px-2 py-0.5">
                                      #{tag}
                                    </span>
                                  ))}
                                </div>
                                <p className="mt-2 text-sm text-muted-foreground line-clamp-2">
                                  {story.summary ?? "Magical bedtime story."}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              <Card className="rounded-2xl border border-border bg-card/95 shadow-xl">
                <CardHeader>
                  <CardTitle>Story details &amp; narration</CardTitle>
                  <CardDescription>
                    Generate, monitor, and download narration for the selected script.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {storiesLoading ? (
                    <div className="space-y-3">
                      <Skeleton className="h-10 w-2/3" />
                      <Skeleton className="h-6 w-full" />
                      <Skeleton className="h-40 w-full" />
                    </div>
                  ) : !selectedStorySummary || !storyDetail ? (
                    <div className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
                      Select a story from the left to see its details and narration progress.
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="rounded-2xl border border-border bg-muted/30 p-6 shadow-sm space-y-6">
                        <div className="flex flex-col gap-2 border-b border-border pb-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <h2 className="text-2xl font-bold text-foreground">{storyDetail.title}</h2>
                              <p className="text-sm text-muted-foreground">
                                {storyDetail.author ? `By ${storyDetail.author}` : "FamFlix Original"} · {storyDetail.category}
                              </p>
                            </div>
                            {storyDetail.coverUrl && (
                              <img
                                src={storyDetail.coverUrl}
                                alt={storyDetail.title}
                                className="h-20 w-20 rounded-xl object-cover shadow"
                              />
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {storyDetail.ageRange?.min !== null && storyDetail.ageRange?.max !== null && (
                              <Badge variant="outline" className="bg-secondary/10 text-secondary-foreground">
                                Ages {storyDetail.ageRange.min}–{storyDetail.ageRange.max}
                              </Badge>
                            )}
                            {storyDetail.tags?.slice(0, 3).map((tag) => (
                              <Badge key={tag} variant="outline" className="bg-secondary/10 text-secondary-foreground">
                                #{tag}
                              </Badge>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-col gap-4 rounded-lg border border-border bg-card/60 p-4">
                          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                            <div>
                              <p className="text-sm text-muted-foreground">
                                {(selectedVoice?.displayName ?? selectedVoice?.name) || "Select a voice"} narrates
                                {selectedStorySummary?.title ? ` “${selectedStorySummary.title}”` : " this story"}.
                              </p>
                              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                {storyDetail.durationMin && (
                                  <Badge variant="outline" className="bg-secondary/10 text-secondary-foreground">
                                    ~{formatMinutes(storyDetail.durationMin)}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="bg-secondary/10 text-secondary-foreground">
                                  {storyDetail.rights}
                                </Badge>
                              </div>
                            </div>
                            <div className="flex flex-col gap-3 md:items-end">
                              <audio
                                ref={playAllAudioRef}
                                className="hidden w-full md:block"
                                controls
                                preload="none"
                                onEnded={nextSection}
                                onError={nextSection}
                              />
                              <div className="flex items-center gap-2">
                                <Button
                                  onClick={() => {
                                    if (playableSections.length === 0) return;
                                    setIsPlayAll((prev) => !prev);
                                  }}
                                  variant={isPlayAll ? "default" : "secondary"}
                                  size="sm"
                                  disabled={playableSections.length === 0}
                                >
                                  {isPlayAll ? (
                                    <>
                                      <i className="fas fa-pause mr-2" /> Pause All
                                    </>
                                  ) : (
                                    <>
                                      <i className="fas fa-play mr-2" /> Play All
                                    </>
                                  )}
                                </Button>
                                <Button size="icon" variant="ghost" onClick={prevSection} disabled={playIndex === 0}>
                                  <i className="fas fa-chevron-left" />
                                </Button>
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  onClick={nextSection}
                                  disabled={playIndex >= playableSections.length - 1}
                                >
                                  <i className="fas fa-chevron-right" />
                                </Button>
                              </div>
                              <audio
                                ref={playAllAudioRef}
                                className="mt-2 w-full md:hidden"
                                controls
                                preload="none"
                                onEnded={nextSection}
                                onError={nextSection}
                              />
                              <div className="mt-2 md:mt-0 md:ml-3">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  asChild
                                  disabled={!selectedSlug || !selectedVoiceProfile || playableSections.length === 0}
                                >
                                  <a
                                    href={`/api/stories/${selectedSlug}/download/full?voiceId=${encodeURIComponent(
                                      selectedVoiceProfile ?? ''
                                    )}`}
                                  >
                                    <i className="fas fa-download mr-2" /> Download All
                                  </a>
                                </Button>
                              </div>
                            </div>

                            <Button
                              onClick={() => handleNarrate(false)}
                              disabled={Boolean(
                                !selectedVoiceProfile ||
                                voicesLoading ||
                                requestNarration.isPending ||
                                Boolean(activeJob) ||
                                (!!selectedVoice?.status && selectedVoice.status !== "ready")
                              )}
                            >
                              {requestNarration.isPending || activeJob ? (
                                <span className="flex items-center gap-2">
                                  <i className="fas fa-circle-notch animate-spin" />
                                  Generating narration...
                                </span>
                              ) : (
                                <span className="flex items-center gap-2">
                                  <i className="fas fa-magic" />
                                  Read with {(selectedVoice?.displayName ?? selectedVoice?.name) || "selected voice"}
                                </span>
                              )}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => handleNarrate(true)}
                              disabled={!selectedVoiceProfile || voicesLoading || requestNarration.isPending || Boolean(activeJob)}
                            >
                              Regenerate audio
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                if (selectedSlug && selectedVoiceProfile) {
                                  refetchStoryAudio();
                                }
                              }}
                              disabled={!selectedSlug || !selectedVoiceProfile || audioFetching}
                            >
                              Refresh status
                            </Button>
                          </div>

                          {jobStatus && (
                            <div className="rounded-lg border border-border bg-card p-4 space-y-3 text-sm">
                              <div className="flex items-center justify-between gap-3">
                                <span className="font-medium text-foreground">Synthesis progress</span>
                                <Badge variant="outline" className={jobStateBadge(jobStatus.state)}>
                                  {JOB_STATE_LABEL[jobStatus.state] ?? jobStatus.state}
                                </Badge>
                              </div>
                              <Progress value={jobStatus.progress ?? 0} />
                              <div className="flex items-center justify-between text-xs text-muted-foreground">
                                <span>Job ID: {jobStatus.id}</span>
                                <span>{Math.round(jobStatus.progress ?? 0)}%</span>
                              </div>
                              {jobStatus.failedReason && (
                                <p className="text-xs text-destructive">{jobStatus.failedReason}</p>
                              )}
                            </div>
                          )}
                        </div>

                        {detailLoading ? (
                          <div className="space-y-3">
                            <Skeleton className="h-5 w-1/2" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-full" />
                          </div>
                        ) : (
                          <>
                            {storyDetail?.content && (
                              <div className="rounded-lg border border-border bg-card p-4 text-sm whitespace-pre-wrap leading-relaxed">
                                {storyDetail.content}
                              </div>
                            )}

                            <div className="space-y-4">
                              <h3 className="text-lg font-semibold text-foreground">Sections &amp; audio</h3>
                              {mergedSections.length === 0 ? (
                                <p className="text-sm text-slate-300">
                                  We could not load story sections yet. Try refreshing the page.
                                </p>
                              ) : (
                                <div className="space-y-4">
                                  {mergedSections.map((section, index) => {
                                    const status = section.audio.status ?? "PENDING";
                                    const badgeClass =
                                      STATUS_BADGE_CLASS[status] ?? STATUS_BADGE_CLASS.PENDING;
                                    return (
                                      <div
                                        key={section.id}
                                        className="rounded-lg border border-border bg-card p-4 space-y-3"
                                      >
                                        <div className="flex flex-wrap items-center justify-between gap-3">
                                          <div>
                                            <p className="text-sm font-semibold text-foreground">
                                              Section {index + 1}
                                              {section.title ? ` · ${section.title}` : ""}
                                            </p>
                                            <p className="text-xs text-muted-foreground">
                                              Words: {section.wordCount}
                                            </p>
                                          </div>
                                          <Badge variant="outline" className={badgeClass}>
                                            {status}
                                          </Badge>
                                        </div>
                                        {section.text && (
                                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                                            {section.text}
                                          </p>
                                        )}
                                        {section.audio.audioUrl ? (
                                          <audio controls preload="none" className="w-full" src={section.audio.audioUrl} />
                                        ) : (
                                          <p className="text-xs text-slate-400">
                                            Audio will appear here once generation completes.
                                          </p>
                                        )}
                                        {section.audio.audioUrl && (
                                          <div className="pt-1">
                                            <Button size="sm" variant="outline" asChild>
                                              <a
                                                href={`/api/stories/${selectedStorySummary?.slug}/download/section/${section.id}?voiceId=${encodeURIComponent(
                                                  selectedVoiceProfile ?? ''
                                                )}`}
                                              >
                                                <i className="fas fa-download mr-2" /> Download Section
                                              </a>
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
