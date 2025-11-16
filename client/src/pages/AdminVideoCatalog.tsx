import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";

interface TemplateVideo {
  id: number;
  title: string;
  description: string;
  thumbnailUrl?: string;
  videoUrl: string;
  duration?: number;
  category?: string;
  tags: string[];
  difficulty?: string;
  isActive: boolean;
  metadata?: {
    pipelineStatus?: string;
    sourceVideoId?: string;
  };
}

const difficultyOptions = ["easy", "medium", "hard"];

export default function AdminVideoCatalog() {
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formState, setFormState] = useState<Partial<TemplateVideo> & { tagsInput?: string }>({});

  const { data, isLoading } = useQuery<TemplateVideo[]>({
    queryKey: ["/api/template-videos", "admin"],
    queryFn: async () => {
      const response = await fetch("/api/template-videos", { credentials: "include" });
      if (!response.ok) {
        throw new Error("Failed to load video library");
      }
      return response.json();
    },
  });

  const videos = data ?? [];

  const selectedVideo = useMemo(() => videos.find((video) => video.id === selectedId) ?? null, [videos, selectedId]);

  useEffect(() => {
    if (!selectedVideo) {
      setFormState({});
      return;
    }
    setFormState({
      ...selectedVideo,
      tagsInput: selectedVideo.tags.join(", "),
    });
  }, [selectedVideo]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedVideo) return;
      const payload = {
        title: formState.title,
        description: formState.description,
        category: formState.category,
        difficulty: formState.difficulty,
        duration: formState.duration,
        tags: formState.tagsInput?.split(",").map((tag) => tag.trim()).filter(Boolean) ?? [],
        isActive: formState.isActive,
      };
      const response = await apiRequest("PATCH", `/api/template-videos/${selectedVideo.id}`, payload);
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || "Failed to update video");
      }
      return response.json();
    },
    onSuccess: () => {
      toast({ title: "Video updated", description: "Catalog entry saved." });
      queryClient.invalidateQueries({ queryKey: ["/api/template-videos", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/template-videos"] });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message || "Unable to save changes.",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (video: TemplateVideo) => {
      const response = await apiRequest("DELETE", `/api/template-videos/${video.id}`);
      await response.json().catch(() => ({}));
      return video.id;
    },
    onSuccess: (deletedId) => {
      toast({ title: "Video removed", description: "Entry deleted from the catalog." });
      queryClient.setQueryData<TemplateVideo[]>(["/api/template-videos", "admin"], (prev) =>
        Array.isArray(prev) ? prev.filter((video) => video.id !== deletedId) : prev
      );
      queryClient.invalidateQueries({ queryKey: ["/api/template-videos", "admin"] });
      queryClient.invalidateQueries({ queryKey: ["/api/template-videos"] });
      setSelectedId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Delete failed",
        description: error?.message || "Unable to remove video.",
        variant: "destructive",
      });
    },
  });

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary" />
      </div>
    );
  }

  if (!isAuthenticated || user?.role !== "admin") {
    return <Redirect to="/" />;
  }

  const handleDelete = () => {
    if (!selectedVideo || deleteMutation.isPending) {
      return;
    }
    if (!window.confirm(`Delete "${selectedVideo.title}"? This cannot be undone.`)) {
      return;
    }
    deleteMutation.mutate(selectedVideo);
  };

  const renderStatusBadge = (video: TemplateVideo) => {
    const status = video.metadata?.pipelineStatus ?? "queued";
    switch (status) {
      case "completed":
        return <Badge className="bg-green-500/10 text-green-600 border-green-500/20">Ready</Badge>;
      case "error":
        return <Badge variant="destructive">Needs attention</Badge>;
      case "processing":
        return <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20">Processing</Badge>;
      default:
        return <Badge variant="secondary">Queued</Badge>;
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-background via-background to-muted/40">
      <div className="container mx-auto space-y-8 py-10">
        <header className="flex flex-col gap-3 rounded-3xl border bg-card/80 p-6 shadow-sm lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-muted-foreground">Video Library Management</p>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Review Catalog</h1>
            <p className="text-sm text-muted-foreground">
              Preview curated videos, adjust metadata, and retire outdated entries.
            </p>
          </div>
          <div className="rounded-xl border bg-muted/20 px-4 py-3 text-sm">
            <p className="font-medium text-foreground">Total videos</p>
            <p className="text-2xl font-semibold">{videos.length}</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
          <Card className="h-full">
            <CardHeader>
              <CardTitle>Catalog</CardTitle>
              <CardDescription>Select an entry to preview or edit.</CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, index) => (
                    <Skeleton key={index} className="h-16 w-full rounded-xl" />
                  ))}
                </div>
              ) : videos.length === 0 ? (
                <p className="text-sm text-muted-foreground">No videos available.</p>
              ) : (
                <ScrollArea className="h-[520px] pr-2">
                  <div className="space-y-3">
                    {videos.map((video) => {
                      const isSelected = video.id === selectedId;
                      return (
                        <button
                          type="button"
                          key={video.id}
                          onClick={() => setSelectedId(video.id)}
                          className={`w-full rounded-xl border p-4 text-left transition ${
                            isSelected ? "border-primary bg-primary/5" : "hover:border-primary/50"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-semibold text-foreground">{video.title}</p>
                              <p className="text-xs text-muted-foreground line-clamp-2">{video.description}</p>
                            </div>
                            {renderStatusBadge(video)}
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {video.category && <Badge variant="outline">{video.category}</Badge>}
                            {video.difficulty && <Badge variant="outline">{video.difficulty}</Badge>}
                            {typeof video.duration === "number" && (
                              <Badge variant="outline">{Math.round(video.duration)}s</Badge>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Card className="h-full">
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>View and edit the selected video.</CardDescription>
            </CardHeader>
            <CardContent>
              {!selectedVideo ? (
                <div className="rounded-lg border border-dashed bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                  Select a video from the left to begin.
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="space-y-3">
                    <Label className="text-xs font-semibold text-muted-foreground">Preview</Label>
                    <video controls className="w-full rounded-xl border bg-black" src={selectedVideo.videoUrl}>
                      Your browser does not support the video tag.
                    </video>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Title</Label>
                      <Input
                        value={formState.title ?? ""}
                        onChange={(event) => setFormState((state) => ({ ...state, title: event.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Input
                        value={formState.category ?? ""}
                        onChange={(event) => setFormState((state) => ({ ...state, category: event.target.value }))}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                      <Label>Difficulty</Label>
                      <Select
                        value={formState.difficulty ?? ""}
                        onValueChange={(value) => setFormState((state) => ({ ...state, difficulty: value }))}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select difficulty" />
                        </SelectTrigger>
                        <SelectContent>
                          {difficultyOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Duration (seconds)</Label>
                      <Input
                        type="number"
                        value={formState.duration ?? ""}
                        onChange={(event) =>
                          setFormState((state) => ({
                            ...state,
                            duration: event.target.value === "" ? undefined : Number(event.target.value),
                          }))
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={formState.description ?? ""}
                      onChange={(event) => setFormState((state) => ({ ...state, description: event.target.value }))}
                      rows={4}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Tags (comma-separated)</Label>
                    <Input
                      value={formState.tagsInput ?? ""}
                      onChange={(event) => setFormState((state) => ({ ...state, tagsInput: event.target.value }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-3">
                    <div>
                      <p className="text-sm font-medium text-foreground">Active</p>
                      <p className="text-xs text-muted-foreground">
                        Toggle visibility in the family-facing catalog.
                      </p>
                    </div>
                    <Switch
                      checked={formState.isActive ?? false}
                      onCheckedChange={(checked) => setFormState((state) => ({ ...state, isActive: checked }))}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <Button onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? "Saving..." : "Save changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={deleteMutation.isPending}
                    >
                      {deleteMutation.isPending ? "Deleting..." : "Delete video"}
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      Pipeline status: {selectedVideo.metadata?.pipelineStatus ?? "queued"}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
