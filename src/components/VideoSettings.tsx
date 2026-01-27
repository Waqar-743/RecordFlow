import type { Resolution } from "../types";
import { SectionWrapper } from "./SectionWrapper";

type Props = {
  selectedResolution: Resolution;
  onResolutionChange: (resolution: Resolution) => void;
};

export function VideoSettings({ selectedResolution, onResolutionChange }: Props) {
  return (
    <SectionWrapper title="Video">
      <div className="flex items-center gap-12 flex-wrap">
        <div className="flex bg-gray-200 p-1 rounded-md">
          <button 
            onClick={() => onResolutionChange("720p")}
            className={`px-6 py-1 rounded text-sm font-semibold transition-all ${
              selectedResolution === "720p" 
                ? "bg-white text-gray-900 shadow-sm" 
                : "text-gray-500 hover:text-gray-700"
            }`}
            type="button"
          >
            720p
          </button>
          <button 
            onClick={() => onResolutionChange("1080p")}
            className={`px-6 py-1 rounded text-sm font-semibold transition-all ${
              selectedResolution === "1080p" 
                ? "bg-blue-600 text-white shadow-sm" 
                : "text-gray-500 hover:text-gray-700"
            }`}
            type="button"
          >
            1080p
          </button>
        </div>
        
        <div className="grid grid-cols-4 gap-x-12 gap-y-1">
          <div className="text-xs font-bold text-gray-400 uppercase">Resolution:</div>
          <div className="text-xs font-bold text-gray-400 uppercase">FPS:</div>
          <div className="text-xs font-bold text-gray-400 uppercase">Bitrate:</div>
          <div className="text-xs font-bold text-gray-400 uppercase">Format:</div>
          
          <div className="text-sm font-medium text-gray-800">
            {selectedResolution === "1080p" ? "1920x1080" : "1280x720"}
          </div>
          <div className="text-sm font-medium text-gray-800">30</div>
          <div className="text-sm font-medium text-gray-800">5000 kbps</div>
          <div className="text-sm font-medium text-gray-800">MP4 - H.264</div>
        </div>
      </div>
    </SectionWrapper>
  );
}
