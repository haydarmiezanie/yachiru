import React from 'react';
import { CategoryScore, CheckCategory } from '../types.js';
import {
  Boxes,
  Key,
  FolderTree,
  FileArchive,
  Cpu,
  Search,
  Activity,
  Network,
  SlidersHorizontal,
  RefreshCw,
  HardDrive,
  AlertOctagon,
  ListOrdered,
  ChevronRight,
  Binary,
} from 'lucide-react';

interface CategoryGridProps {
  categories: CategoryScore[];
  selectedCategory: CheckCategory | 'all';
  onSelectCategory: (category: CheckCategory | 'all') => void;
}

const CATEGORY_ICONS: Record<CheckCategory, React.ElementType> = {
  part_health: Boxes,
  primary_key: Key,
  partitioning: FolderTree,
  compression: FileArchive,
  schema_type: Binary,
  table_engine: Cpu,
  skip_indices: Search,
  query_performance: Activity,
  replication_distributed: Network,
  server_settings: SlidersHorizontal,
  mutations: RefreshCw,
  disk_space: HardDrive,
  system_errors: AlertOctagon,
  replication_queue: ListOrdered,
};

export const CategoryGrid: React.FC<CategoryGridProps> = ({
  categories,
  selectedCategory,
  onSelectCategory,
}) => {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-base font-bold text-white tracking-tight">Optimization Categories</h3>
          <p className="text-xs text-zinc-400">
            Click any category to filter findings by subsystem
          </p>
        </div>

        {selectedCategory !== 'all' && (
          <button
            onClick={() => onSelectCategory('all')}
            className="text-xs font-semibold text-rose-400 hover:text-rose-300 transition"
          >
            Clear Filter (Show All)
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {categories.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.category] || Boxes;
          const isSelected = selectedCategory === cat.category;

          let scoreBadge = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
          let borderHighlight = isSelected ? 'border-emerald-500' : 'border-zinc-800 hover:border-zinc-700';

          if (cat.score < 60) {
            scoreBadge = 'text-rose-400 bg-rose-500/10 border-rose-500/20';
            borderHighlight = isSelected ? 'border-rose-500' : 'border-zinc-800 hover:border-zinc-700';
          } else if (cat.score < 85) {
            scoreBadge = 'text-amber-400 bg-amber-500/10 border-amber-500/20';
            borderHighlight = isSelected ? 'border-amber-500' : 'border-zinc-800 hover:border-zinc-700';
          }

          return (
            <button
              key={cat.category}
              onClick={() => onSelectCategory(isSelected ? 'all' : cat.category)}
              className={`text-left p-4 rounded-xl bg-zinc-900/70 border ${borderHighlight} transition-all duration-200 shadow-sm relative overflow-hidden group cursor-pointer`}
            >
              {isSelected && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-rose-500 to-amber-500" />
              )}

              <div className="flex items-start justify-between gap-2 mb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-zinc-800 border border-zinc-700/60 text-zinc-300 group-hover:text-white transition">
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h4 className="text-xs font-bold text-zinc-100 group-hover:text-white transition">
                      {cat.name}
                    </h4>
                    <span className="text-[11px] text-zinc-400">
                      {cat.total_checks} check{cat.total_checks === 1 ? '' : 's'} evaluated
                    </span>
                  </div>
                </div>

                <div className={`px-2 py-0.5 rounded-full border text-xs font-bold font-mono ${scoreBadge}`}>
                  {cat.score}
                </div>
              </div>

              <p className="text-[11px] text-zinc-400 line-clamp-2 mb-3 leading-relaxed">
                {cat.description}
              </p>

              <div className="flex items-center justify-between text-[11px] pt-2 border-t border-zinc-800/80">
                <div className="flex items-center gap-2 font-mono">
                  {cat.critical_count > 0 && (
                    <span className="text-rose-400 font-semibold">{cat.critical_count} critical</span>
                  )}
                  {cat.warning_count > 0 && (
                    <span className="text-amber-400 font-semibold">{cat.warning_count} warning</span>
                  )}
                  {cat.critical_count === 0 && cat.warning_count === 0 && (
                    <span className="text-emerald-400 font-semibold">All optimal</span>
                  )}
                </div>

                <div className="flex items-center gap-0.5 text-zinc-400 group-hover:text-zinc-200 transition text-[11px]">
                  <span>Inspect</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};
