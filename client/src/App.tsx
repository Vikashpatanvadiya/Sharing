import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch } from "wouter";
import { Toaster } from "@/components/ui/toaster";
import { SiteFooter } from "@/components/SiteFooter";
import AlbumPage from "@/pages/Album";
import CreateAlbumPage from "@/pages/CreateAlbum";
import HomePage from "@/pages/Home";
import JoinAlbumPage from "@/pages/JoinAlbum";
import NotFoundPage from "@/pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 15_000,
      retry: 1,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="flex min-h-[100dvh] flex-col">
        <div className="flex-1">
          <Switch>
            <Route path="/" component={HomePage} />
            <Route path="/create" component={CreateAlbumPage} />
            <Route path="/join" component={JoinAlbumPage} />
            <Route path="/album/:albumId" component={AlbumPage} />
            <Route component={NotFoundPage} />
          </Switch>
        </div>
        <SiteFooter />
      </div>
      <Toaster />
    </QueryClientProvider>
  );
}
