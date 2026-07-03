import "./App.css";
import { RegionPickerWindow } from "./components/RegionPickerWindow";
import { RecorderPage } from "./pages/RecorderPage";

function App() {
  const params = new URLSearchParams(window.location.search);

  if (params.get("picker") === "1") {
    return <RegionPickerWindow />;
  }

  return <RecorderPage />;
}

export default App;
