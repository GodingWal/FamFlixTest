import { useMemo } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Navigation } from "@/components/Navigation";
import Seo from "@/components/Seo";
import { BASE_URL } from "@/components/Seo";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
// removed Switch: narration is always generated using selected voice
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const storyCategories = [
  { value: "BEDTIME", label: "Bedtime" },
  { value: "CLASSIC", label: "Classic" },
  { value: "FAIRYTALE", label: "Fairytale" },
  { value: "ADVENTURE", label: "Adventure" },
  { value: "EDUCATIONAL", label: "Educational" },
  { value: "CUSTOM", label: "Custom" },
] as const;

const storySchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters").max(120),
  templateSlug: z.string().min(1, "Select a story template"),
  voiceProfileId: z.string().min(1, "Select a voice profile"),
});

type StoryFormValues = z.infer<typeof storySchema>;

export default function CreateStory() {
  const [, setLocation] = useLocation();

  const { data: templatesResponse, isLoading: loadingTemplates } = useQuery({
    queryKey: ["story-catalog", "all"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/stories?limit=1000");
      const json = await response.json();
      // Normalize to an array of stories and sort. The server already restricts to public/slugged stories.
      const stories = Array.isArray(json?.stories) ? json.stories : [];
      stories.sort((a: any, b: any) => String(a.title).localeCompare(String(b.title)));
      return { stories };
    },
  });

  const { data: voiceProfiles = [], isLoading: loadingVoices } = useQuery({
    queryKey: ["/api/voice-profiles"],
    queryFn: async () => {
      const response = await apiRequest("GET", "/api/voice-profiles");
      return response.json();
    },
  });

  const form = useForm<StoryFormValues>({
    resolver: zodResolver(storySchema),
    defaultValues: {
      title: "",
      templateSlug: "",
      voiceProfileId: "",
    },
  });

  const createStoryMutation = useMutation({
    mutationFn: async (values: StoryFormValues) => {
      const payload = {
        title: values.title.trim(),
        templateSlug: values.templateSlug,
        voiceProfileId: values.voiceProfileId,
      };
      const response = await apiRequest("POST", "/api/stories", payload);
      const created = await response.json();
      // Kick off narration immediately using the chosen voice
      try {
        await apiRequest(
          "POST",
          `/api/stories/${created?.story?.slug}/read`,
          { voiceId: values.voiceProfileId }
        );
      } catch (e) {
        // Non-fatal; user can generate in Stories page
      }
      return created;
    },
    onSuccess: (data) => {
      toast({
        title: "Story created!",
        description: valuesMessage(data),
      });
      form.reset({
        title: "",
        templateSlug: "",
        voiceProfileId: "",
      });
      setLocation("/stories");
    },
    onError: (error: any) => {
      toast({
        title: "Story creation failed",
        description: error?.message || "We couldn't create your story. Try again.",
        variant: "destructive",
      });
    },
  });

  const valuesMessage = (data: any) => {
    if (!data?.story?.title) {
      return "Your story is ready.";
    }
    return `“${data.story.title}” is ready to view in your story library.`;
  };

  const pageDescription = useMemo(() => {
    return "Choose a story template, name it, and select a voice clone. We’ll generate narration right away.";
  }, []);

  const onSubmit = (values: StoryFormValues) => {
    createStoryMutation.mutate(values);
  };

  return (
    <div className="min-h-screen bg-background">
      <Seo
        title="Create a new story"
        description="Craft a custom AI story for your family inside FamFlix."
        canonical={`${BASE_URL}/stories/create`}
      />
      <Navigation />
      <div className="relative">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-primary/15 via-transparent to-transparent" />
        <div className="container relative z-10 mx-auto px-4 pt-24 pb-16">
          <div className="max-w-4xl mx-auto space-y-8">
            <div className="rounded-3xl border border-border/60 bg-card/80 p-6 shadow-lg backdrop-blur">
              <p className="text-xs font-semibold uppercase tracking-[0.25em] text-primary">
                Story Studio
              </p>
              <h1 className="mt-2 text-4xl font-semibold text-foreground">Create a new story</h1>
              <p className="mt-3 text-muted-foreground leading-relaxed">
                Describe the story you want to hear, choose the best category, and optionally let FamFlix
                narrate it instantly with your favorite cloned voice.
              </p>
            </div>

            <Card className="rounded-2xl border border-border bg-card/95 shadow-xl">
              <CardHeader>
                <CardTitle>Story details</CardTitle>
                <CardDescription>{pageDescription}</CardDescription>
              </CardHeader>
              <CardContent>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                    <FormField
                      control={form.control}
                      name="title"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Story title</FormLabel>
                          <FormControl>
                            <Input placeholder="E.g., Luna and the Starlit Garden" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-4 md:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="templateSlug"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Story template</FormLabel>
                            {loadingTemplates ? (
                              <Skeleton className="h-10 w-full rounded-xl" />
                            ) : (templatesResponse?.stories ?? []).length > 0 ? (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="rounded-xl">
                                    <SelectValue placeholder="Choose a story template" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {(templatesResponse?.stories ?? []).map((s: any) => (
                                    <SelectItem key={s.slug} value={s.slug}>
                                      {s.title}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <p className="text-sm text-muted-foreground">No templates available yet. Ingest stories under <code>content/stories/</code> to populate this list.</p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="voiceProfileId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Voice profile</FormLabel>
                            {loadingVoices ? (
                              <Skeleton className="h-10 w-full rounded-xl" />
                            ) : (Array.isArray(voiceProfiles) && voiceProfiles.filter((p: any) => p.status === 'ready').length > 0) ? (
                              <Select value={field.value} onValueChange={field.onChange}>
                                <FormControl>
                                  <SelectTrigger className="rounded-xl">
                                    <SelectValue placeholder="Select a voice profile" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {(voiceProfiles as any[]).filter((p: any) => p.status === 'ready').map((profile: any) => (
                                    <SelectItem key={profile.id} value={profile.id}>
                                      {(profile.displayName ?? profile.name) || profile.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <p className="text-sm text-muted-foreground">No voices available. Create one first in Voice Cloning.</p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="rounded-2xl border border-border/60 bg-muted/20 p-5 text-sm text-muted-foreground">
                      After creation, narration will start automatically with your selected voice. You can monitor progress in Stories.
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-4">
                      <div className="text-sm text-muted-foreground">
                        Need inspiration?{" "}
                        <a
                          href="/stories"
                          className="text-primary hover:underline"
                        >
                          Browse existing stories
                        </a>
                      </div>
                      <Button
                        type="submit"
                        className={cn("px-6", createStoryMutation.isPending && "opacity-90")}
                        disabled={createStoryMutation.isPending}
                      >
                        {createStoryMutation.isPending ? (
                          <span className="flex items-center gap-2">
                            <i className="fas fa-circle-notch animate-spin" />
                            Creating story...
                          </span>
                        ) : (
                          "Create story"
                        )}
                      </Button>
                    </div>
                  </form>
                </Form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
