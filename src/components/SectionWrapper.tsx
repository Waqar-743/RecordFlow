import { useState } from "react";

interface SectionWrapperProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

export function SectionWrapper({ title, children, defaultOpen = true }: SectionWrapperProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="bg-gray-200/40 rounded-xl overflow-hidden border border-gray-200 shadow-sm">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-6 py-4 flex justify-between items-center group bg-gray-100 hover:bg-gray-200 transition-colors"
        type="button"
      >
        <h2 className="text-lg font-bold text-gray-800">{title}</h2>
        <svg 
          className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} 
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      <div className={`transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[1000px] opacity-100 p-6' : 'max-h-0 opacity-0 overflow-hidden'} bg-white`}>
        {children}
      </div>
    </div>
  );
}
