import "./App.css";
import { RegionPickerWindow } from "./components/RegionPickerWindow";
import { TeleprompterWindow } from "./components/TeleprompterWindow";
import { RecorderPage } from "./pages/RecorderPage";

function App() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("picker") === "1") {
    return <RegionPickerWindow />;
  }

  if (params.get("teleprompter") === "1") {
    return <TeleprompterWindow standalone />;
  }

  return <RecorderPage />;
}

export default App;
