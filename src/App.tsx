import "./styles/app.css";
import { FloatingRecordingControls } from "./components/FloatingRecordingControls";
import { RegionPickerWindow } from "./components/RegionPickerWindow";
import { TeleprompterWindow } from "./components/TeleprompterWindow";
import { StudioApp } from "./pages/StudioApp";
import { ThemeProvider } from "./theme/ThemeProvider";

function App() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("picker") === "1") {
    return (
      <ThemeProvider>
        <RegionPickerWindow />
      </ThemeProvider>
    );
  }

  if (params.get("teleprompter") === "1") {
    return (
      <ThemeProvider>
        <TeleprompterWindow standalone />
      </ThemeProvider>
    );
  }

  if (params.get("controls") === "1") {
    return (
      <ThemeProvider>
        <FloatingRecordingControls standalone />
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <StudioApp />
    </ThemeProvider>
  );
}

export default App;
