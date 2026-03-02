import { MultiRoomAudioDashboard } from "./components/MultiRoomAudioDashboard";

export function App() {
  const apiBaseUrl = import.meta.env.VITE_HOMEPLANE_API_URL || window.location.origin;
  const apiKey = import.meta.env.VITE_HOMEPLANE_API_KEY;

  if (!apiKey) {
    return (
      <div className="min-h-screen p-6">
        <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-amber-300/70 bg-amber-50/90 p-6 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100">
          Missing `VITE_HOMEPLANE_API_KEY` in frontend environment.
        </div>
      </div>
    );
  }

  return <MultiRoomAudioDashboard apiBaseUrl={apiBaseUrl} apiKey={apiKey} />;
}
