import React from 'react';
import type {
  SemanticClassEntry,
  SemanticClickSelection,
} from '../types/microscope.ts';
import type { ClassPixelStat, LoadedMaskData } from '../utils/maskProcessor.ts';

interface SemanticClassLegendBarProps {
  semanticClasses: SemanticClassEntry[];
  visibleClassIds: Set<number>;
  classPixelStats: Record<number, ClassPixelStat>;
  onToggleClass: (classId: number) => void;
  onShowAll: () => void;
  onHideAll: () => void;
}

/**
 * Under-viewport legend and per-class overlay toggle bar for semantic segmentation masks.
 * Displays background, cell wall, cytoplasm, and nucleus (or metadata-declared classes)
 * explicitly framed as model predictions.
 */
export const SemanticClassLegendBar: React.FC<SemanticClassLegendBarProps> = ({
  semanticClasses,
  visibleClassIds,
  classPixelStats,
  onToggleClass,
  onShowAll,
  onHideAll,
}) => {
  if (semanticClasses.length === 0) return null;

  const anyVisible = visibleClassIds.size > 0;
  const allVisible = semanticClasses.every((cls) => visibleClassIds.has(cls.id));

  return (
    <div
      data-testid="semantic-class-legend"
      className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low px-3 py-2 rounded-2xl border border-outline-variant/20 shadow-2xs"
    >
      <div className="flex flex-wrap items-center gap-1.5 flex-1">
        <span className="font-label-sm text-[11px] text-on-surface-variant font-semibold whitespace-nowrap mr-1">
          Predicted Classes:
        </span>
        {semanticClasses.map((cls) => {
          const isVisible = visibleClassIds.has(cls.id);
          const stat = classPixelStats[cls.id];
          const pctLabel = stat ? `${stat.percentage.toFixed(1)}%` : '0.0%';

          return (
            <button
              key={cls.id}
              type="button"
              onClick={() => onToggleClass(cls.id)}
              aria-pressed={isVisible}
              aria-label={`Toggle ${cls.name} predicted class overlay`}
              className={`px-2.5 py-1 rounded-xl font-label-sm text-xs transition-all whitespace-nowrap flex items-center gap-1.5 border ${
                isVisible
                  ? 'bg-surface-container-lowest text-on-surface border-primary/40 font-semibold shadow-2xs'
                  : 'bg-surface-container/60 text-on-surface-variant border-outline-variant/20 opacity-65 hover:opacity-100'
              }`}
              title={`Predicted class: ${cls.name} (ID ${cls.id}) • ${pctLabel} of frame • Click to ${
                isVisible ? 'hide' : 'show'
              } overlay`}
            >
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/20"
                style={{
                  backgroundColor: cls.color,
                  opacity: isVisible ? 1 : 0.35,
                }}
              />
              <span>{cls.name}</span>
              <span className="font-metric-reticle text-[10px] opacity-75">{pctLabel}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onShowAll}
          disabled={allVisible}
          aria-label="Show all class overlays"
          className="px-2 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high disabled:opacity-40 text-[10px] font-label-sm font-semibold text-on-surface-variant transition-colors whitespace-nowrap"
        >
          Show all
        </button>
        <button
          type="button"
          onClick={onHideAll}
          disabled={!anyVisible}
          aria-label="Hide all class overlays"
          className="px-2 py-1 rounded-lg bg-surface-container hover:bg-surface-container-high disabled:opacity-40 text-[10px] font-label-sm font-semibold text-on-surface-variant transition-colors whitespace-nowrap"
        >
          Hide all
        </button>
      </div>
    </div>
  );
};

interface SemanticInspectionPanelProps {
  currentFrameId: string | null;
  loadedMaskData: LoadedMaskData;
  semanticClasses: SemanticClassEntry[];
  visibleClassIds: Set<number>;
  classPixelStats: Record<number, ClassPixelStat>;
  semanticSelection: SemanticClickSelection | null;
  onToggleClass: (classId: number) => void;
  onClearSelection: () => void;
  onClearRegionHighlight: () => void;
}

/**
 * Right-column inspection panel for semantic-only class-mask responses (no cellIdMaskUrl).
 * Presents model-predicted classes truthfully as predictions and labels clicked connected
 * areas strictly as approximate connected regions without inventing cell IDs or structures.
 */
export const SemanticInspectionPanel: React.FC<SemanticInspectionPanelProps> = ({
  currentFrameId,
  loadedMaskData,
  semanticClasses,
  visibleClassIds,
  classPixelStats,
  semanticSelection,
  onToggleClass,
  onClearSelection,
  onClearRegionHighlight,
}) => {
  const totalPixels = loadedMaskData.width * loadedMaskData.height;

  if (!semanticSelection) {
    return (
      <div
        data-testid="semantic-idle-panel"
        className="bg-surface-container-lowest rounded-2xl p-6 shadow-sm border border-outline-variant/20 flex flex-col gap-4 animate-fade-in"
      >
        <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center text-primary">
          <span className="material-symbols-outlined text-[26px]">layers</span>
        </div>

        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[10px] px-2 py-0.5 bg-primary-fixed text-primary rounded font-metric-reticle font-bold uppercase tracking-wider">
              Model Predictions
            </span>
          </div>
          <h3 className="font-headline-sm text-base text-on-surface font-bold">
            Semantic Class Mask Ready
          </h3>
          <p className="font-body-sm text-xs text-on-surface-variant mt-1 leading-relaxed">
            Class-level segmentation completed for frame{' '}
            <strong className="text-primary">{currentFrameId || 'active'}</strong> (
            {loadedMaskData.width}×{loadedMaskData.height}). Click anywhere on the captured still
            to check the model&apos;s predicted class at that location.
          </p>
        </div>

        {/* Predicted Class Coverage Summary */}
        <div className="flex flex-col gap-2">
          <span className="font-label-md text-xs font-semibold text-on-surface">
            Predicted Classes in Mask:
          </span>
          <div className="flex flex-col gap-1.5">
            {semanticClasses.map((cls) => {
              const isVisible = visibleClassIds.has(cls.id);
              const stat = classPixelStats[cls.id];
              const pct = stat ? stat.percentage.toFixed(1) : '0.0';

              return (
                <button
                  key={cls.id}
                  type="button"
                  onClick={() => onToggleClass(cls.id)}
                  aria-pressed={isVisible}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors text-left border border-outline-variant/20"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className="w-3 h-3 rounded-full shrink-0 border border-black/20"
                      style={{
                        backgroundColor: cls.color,
                        opacity: isVisible ? 1 : 0.35,
                      }}
                    />
                    <div className="flex flex-col">
                      <span className="font-label-md text-xs font-semibold text-on-surface">
                        {cls.name}
                      </span>
                      <span className="text-[10px] text-on-surface-variant">
                        Predicted class #{cls.id} • Overlay {isVisible ? 'visible' : 'hidden'}
                      </span>
                    </div>
                  </div>
                  <span className="font-metric-reticle text-[11px] text-primary font-bold">
                    {pct}%
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="p-3 bg-surface-container-low rounded-xl border border-outline-variant/20 flex items-start gap-2 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-primary text-[18px] shrink-0 mt-0.5">
            info
          </span>
          <span>
            This response provides a semantic class mask without per-cell instance IDs. Clicking a
            cell-wall pixel reports the predicted class and does not isolate one cell&apos;s
            complete border.
          </span>
        </div>
      </div>
    );
  }

  const { classEntry, maskX, maskY, classId, connectedRegion } = semanticSelection;
  const regionPct =
    connectedRegion && totalPixels > 0
      ? ((connectedRegion.pixelCount / totalPixels) * 100).toFixed(2)
      : null;
  const bboxWidth = connectedRegion
    ? connectedRegion.bounds.maxX - connectedRegion.bounds.minX + 1
    : 0;
  const bboxHeight = connectedRegion
    ? connectedRegion.bounds.maxY - connectedRegion.bounds.minY + 1
    : 0;

  return (
    <div
      data-testid="semantic-selection-card"
      className="bg-surface-container-lowest rounded-2xl p-5 shadow-sm border border-outline-variant/20 flex flex-col gap-4 animate-fade-in"
    >
      {/* Header: Predicted Class */}
      <div className="flex items-start justify-between pb-2 border-b border-surface-container-high gap-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span
              className="w-2.5 h-2.5 rounded-full border border-black/20"
              style={{ backgroundColor: classEntry.color }}
            />
            <span className="font-label-sm text-[11px] uppercase tracking-wider text-primary font-semibold">
              Model Prediction
            </span>
          </div>
          <h2 className="font-headline-lg text-2xl text-primary leading-tight font-display font-bold">
            {classEntry.name}
          </h2>
          <span className="font-metric-reticle text-[11px] text-on-surface-variant mt-0.5">
            Pixel ({maskX}, {maskY}) • Class ID {classId}
          </span>
        </div>

        <button
          type="button"
          onClick={onClearSelection}
          aria-label="Clear location inspection"
          className="w-8 h-8 rounded-xl bg-surface-container hover:bg-surface-container-high text-on-surface-variant flex items-center justify-center transition-colors shrink-0"
          title="Clear location inspection"
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Explicit disclaimer when clicking a predicted Cell Wall pixel */}
      {classEntry.isWall && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2 text-xs text-amber-800 dark:text-amber-300">
          <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">warning</span>
          <span>
            Predicted cell-wall pixel in a semantic class mask. Clicking here does not select one
            cell&apos;s complete border or assign a cell ID.
          </span>
        </div>
      )}

      {/* Approximate Connected Region Card (only when mask supports a non-background connected component) */}
      {connectedRegion ? (
        <div className="bg-surface-container p-3.5 rounded-xl flex flex-col gap-2 border border-outline-variant/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-primary font-label-lg text-xs font-bold">
              <span className="material-symbols-outlined text-[16px]">polyline</span>
              <span>Approximate connected region</span>
            </div>
            <button
              type="button"
              onClick={onClearRegionHighlight}
              className="text-[10px] font-label-sm text-on-surface-variant hover:text-primary underline"
            >
              Clear highlight
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-surface-container-low rounded-lg px-2.5 py-1.5">
              <span className="block text-[10px] text-on-surface-variant">Connected Pixels</span>
              <span className="font-metric-reticle font-semibold text-on-surface">
                {connectedRegion.pixelCount.toLocaleString()} px
                {regionPct ? ` (${regionPct}%)` : ''}
              </span>
            </div>
            <div className="bg-surface-container-low rounded-lg px-2.5 py-1.5">
              <span className="block text-[10px] text-on-surface-variant">Region Bounds</span>
              <span className="font-metric-reticle font-semibold text-on-surface">
                {bboxWidth} × {bboxHeight} px
              </span>
            </div>
          </div>

          {connectedRegion.touchesEdge && (
            <div className="flex items-center gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
              <span className="material-symbols-outlined text-[14px]">crop_free</span>
              <span>Approximate connected region reaches the micrograph edge.</span>
            </div>
          )}

          <p className="font-body-sm text-[11px] text-on-surface-variant leading-relaxed">
            White outline indicates an approximate 4-connected region sharing the{' '}
            <strong>{classEntry.name}</strong> prediction—not a verified individual cell or
            organelle identity.
          </p>
        </div>
      ) : (
        <div className="bg-surface-container p-3 rounded-xl flex items-start gap-2 border border-outline-variant/20 text-xs text-on-surface-variant">
          <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5 text-on-surface-variant">
            info
          </span>
          <span>
            {classEntry.isBackground
              ? 'Predicted background at this location. No connected foreground region is highlighted.'
              : 'No connected region highlighted. Click a predicted foreground pixel to outline an approximate connected region.'}
          </span>
        </div>
      )}

      {/* Truthful Scope Footnote */}
      <div className="flex items-start gap-2 pt-2 border-t border-surface-container-high text-[11px] text-on-surface-variant">
        <span className="material-symbols-outlined text-[15px] shrink-0 mt-0.5 text-primary">
          fact_check
        </span>
        <span>
          Semantic segmentation output only: per-cell IDs, individual organelle identities, and
          reviewed biological annotations are not attached to this mask.
        </span>
      </div>
    </div>
  );
};
