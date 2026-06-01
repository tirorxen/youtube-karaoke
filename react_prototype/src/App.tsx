import { CssBaseline, CssVarsProvider } from "@mui/joy";

import { PlaybackScreen } from "./components/PlaybackScreen";

export function App() {
  return (
    <CssVarsProvider defaultMode="dark">
      <CssBaseline />
      <PlaybackScreen />
    </CssVarsProvider>
  );
}
