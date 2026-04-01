import React, { useState, useMemo } from 'react';
import { X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ImageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: any[];
  selectedUrl: string;
  onSelect: (url: string) => void;
  /** 앱인토스 로비: 밝은 패널·토스 블루 */
  tossStyling?: boolean;
}

export const ImageSelectorModal: React.FC<ImageSelectorModalProps> = ({
  isOpen,
  onClose,
  images,
  selectedUrl,
  onSelect,
  tossStyling = false,
}) => {
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const categories = useMemo(() => {
    const cats = new Set(images.map(img => img.category || 'Uncategorized'));
    return ['All', ...Array.from(cats)].sort();
  }, [images]);

  const filteredImages = useMemo(() => {
    if (activeCategory === 'All') return images;
    return images.filter(img => (img.category || 'Uncategorized') === activeCategory);
  }, [images, activeCategory]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className={`absolute inset-0 backdrop-blur-sm ${tossStyling ? "bg-slate-900/40" : "bg-slate-950/80"}`}
          onClick={onClose}
        />
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className={`relative w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] border ${
            tossStyling
              ? "bg-white border-[#D9E8FF]"
              : "bg-slate-900 border-slate-800"
          }`}
        >
          {/* Header */}
          <div
            className={`flex items-center justify-between p-4 border-b ${
              tossStyling ? "border-[#D9E8FF] bg-[#F4F8FF]" : "border-slate-800 bg-slate-900/50"
            }`}
          >
            <h3 className={`text-lg font-semibold ${tossStyling ? "text-slate-900" : "text-white"}`}>
              Select Puzzle Image
            </h3>
            <button
              onClick={onClose}
              className={`p-2 rounded-lg transition-colors ${
                tossStyling
                  ? "text-[#2F6FE4] hover:bg-[#EAF2FF]"
                  : "text-slate-400 hover:text-white hover:bg-slate-800"
              }`}
            >
              <X size={20} />
            </button>
          </div>

          {/* Categories */}
          <div
            className={`p-4 border-b overflow-x-auto custom-scrollbar flex gap-2 ${
              tossStyling ? "border-[#D9E8FF] bg-white" : "border-slate-800"
            }`}
          >
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                  activeCategory === cat
                    ? tossStyling
                      ? "bg-[#2F6FE4] text-white"
                      : "bg-indigo-500 text-white"
                    : tossStyling
                      ? "bg-[#F4F8FF] text-slate-600 border border-[#D9E8FF] hover:border-[#2F6FE4]/40"
                      : "bg-slate-800 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Image Grid */}
          <div className={`flex-1 overflow-y-auto p-4 custom-scrollbar ${tossStyling ? "bg-white" : ""}`}>
            {filteredImages.length === 0 ? (
              <div
                className={`flex flex-col items-center justify-center h-40 ${tossStyling ? "text-slate-500" : "text-slate-500"}`}
              >
                <p>No images found in this category.</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                {filteredImages.map(img => (
                  <div 
                    key={img.id}
                    onClick={() => {
                      onSelect(img.url);
                      onClose();
                    }}
                    className={`group relative aspect-video rounded-xl overflow-hidden cursor-pointer border-2 transition-all duration-200 ${
                      selectedUrl === img.url
                        ? tossStyling
                          ? "border-[#2F6FE4] shadow-[0_0_15px_rgba(47,111,228,0.35)] scale-[0.98]"
                          : "border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.5)] scale-[0.98]"
                        : tossStyling
                          ? "border-[#D9E8FF] hover:border-[#2F6FE4]/50 hover:scale-[1.02]"
                          : "border-transparent hover:border-slate-600 hover:scale-[1.02]"
                    }`}
                  >
                    <img 
                      src={img.url} 
                      alt={img.title || `${img.category} - ${img.style}`} 
                      className="w-full h-full object-cover"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                    
                    <div className="absolute bottom-0 left-0 right-0 p-3 translate-y-4 group-hover:translate-y-0 transition-transform duration-200">
                      <p className="text-white text-sm font-medium truncate">
                        {img.title || `${img.category} - ${img.style}`}
                      </p>
                    </div>

                    {selectedUrl === img.url && (
                      <div
                        className={`absolute top-2 right-2 text-white p-1 rounded-full shadow-lg ${
                          tossStyling ? "bg-[#2F6FE4]" : "bg-indigo-500"
                        }`}
                      >
                        <Check size={16} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
