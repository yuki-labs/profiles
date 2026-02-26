import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, RotateCcw, Plus, X } from 'lucide-react';
import './NameColorPicker.css';

interface GradientStop {
    color: string;
    position: number;
}

interface NameColorChange {
    nameColorMode: 'solid' | 'gradient' | undefined;
    nameColor: string | undefined;
    nameGradient: { stops: GradientStop[]; angle: number } | undefined;
}

interface Props {
    colorMode: 'solid' | 'gradient' | undefined;
    color: string | undefined;
    gradient: { stops: GradientStop[]; angle: number } | undefined;
    onChange: (change: NameColorChange) => void;
}

const DEFAULT_GRADIENT: { stops: GradientStop[]; angle: number } = {
    stops: [
        { color: '#6366f1', position: 0 },
        { color: '#ec4899', position: 100 },
    ],
    angle: 90,
};

function buildGradientCSS(stops: GradientStop[], angle: number): string {
    const sorted = [...stops].sort((a, b) => a.position - b.position);
    const colorStops = sorted.map(s => `${s.color} ${s.position}%`).join(', ');
    return `linear-gradient(${angle}deg, ${colorStops})`;
}

const NameColorPicker: React.FC<Props> = ({ colorMode, color, gradient, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Local editing state
    const [localMode, setLocalMode] = useState<'none' | 'solid' | 'gradient'>(colorMode || 'none');
    const [localColor, setLocalColor] = useState(color || '#6366f1');
    const [localGradient, setLocalGradient] = useState(gradient || DEFAULT_GRADIENT);

    // Sync local state when props change externally
    useEffect(() => {
        setLocalMode(colorMode || 'none');
        if (color) setLocalColor(color);
        if (gradient) setLocalGradient(gradient);
    }, [colorMode, color, gradient]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handleClick = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [isOpen]);

    const emitChange = (
        mode: 'none' | 'solid' | 'gradient',
        solidColor: string,
        grad: { stops: GradientStop[]; angle: number }
    ) => {
        if (mode === 'none') {
            onChange({ nameColorMode: undefined, nameColor: undefined, nameGradient: undefined });
        } else if (mode === 'solid') {
            onChange({ nameColorMode: 'solid', nameColor: solidColor, nameGradient: undefined });
        } else {
            onChange({ nameColorMode: 'gradient', nameColor: undefined, nameGradient: grad });
        }
    };

    const handleModeChange = (mode: 'none' | 'solid' | 'gradient') => {
        setLocalMode(mode);
        emitChange(mode, localColor, localGradient);
    };

    const handleSolidColorChange = (newColor: string) => {
        setLocalColor(newColor);
        emitChange('solid', newColor, localGradient);
    };

    const handleStopColorChange = (index: number, newColor: string) => {
        const newStops = [...localGradient.stops];
        newStops[index] = { ...newStops[index], color: newColor };
        const newGrad = { ...localGradient, stops: newStops };
        setLocalGradient(newGrad);
        emitChange('gradient', localColor, newGrad);
    };

    const handleStopPositionChange = (index: number, pos: number) => {
        const clamped = Math.max(0, Math.min(100, pos));
        const newStops = [...localGradient.stops];
        newStops[index] = { ...newStops[index], position: clamped };
        const newGrad = { ...localGradient, stops: newStops };
        setLocalGradient(newGrad);
        emitChange('gradient', localColor, newGrad);
    };

    const handleAngleChange = (angle: number) => {
        const newGrad = { ...localGradient, angle };
        setLocalGradient(newGrad);
        emitChange('gradient', localColor, newGrad);
    };

    const addStop = () => {
        const stops = localGradient.stops;
        // Insert at average position of last two stops with a blended color
        const lastPos = stops[stops.length - 1]?.position ?? 100;
        const secondLastPos = stops[stops.length - 2]?.position ?? 0;
        const newPos = Math.min(100, Math.round((lastPos + secondLastPos) / 2 + (lastPos - secondLastPos) / 2));
        const newStops = [...stops, { color: '#a855f7', position: Math.min(newPos + 10, 100) }];
        const newGrad = { ...localGradient, stops: newStops };
        setLocalGradient(newGrad);
        emitChange('gradient', localColor, newGrad);
    };

    const removeStop = (index: number) => {
        if (localGradient.stops.length <= 2) return;
        const newStops = localGradient.stops.filter((_, i) => i !== index);
        const newGrad = { ...localGradient, stops: newStops };
        setLocalGradient(newGrad);
        emitChange('gradient', localColor, newGrad);
    };

    const handleReset = () => {
        setLocalMode('none');
        emitChange('none', localColor, localGradient);
        setIsOpen(false);
    };

    // Trigger display
    let triggerSwatchStyle: React.CSSProperties = {};
    let triggerLabel = 'Default';
    if (colorMode === 'solid' && color) {
        triggerSwatchStyle = { background: color };
        triggerLabel = color.toUpperCase();
    } else if (colorMode === 'gradient' && gradient) {
        triggerSwatchStyle = { background: buildGradientCSS(gradient.stops, gradient.angle) };
        triggerLabel = `Gradient (${gradient.stops.length} stops)`;
    }

    return (
        <div className="name-color-picker" ref={containerRef}>
            <button
                className={`name-color-trigger ${isOpen ? 'open' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                type="button"
            >
                <span className="trigger-label">Color</span>
                <span className="trigger-preview">
                    {colorMode && (
                        <span className="trigger-color-swatch" style={triggerSwatchStyle} />
                    )}
                    {triggerLabel}
                </span>
                <ChevronDown size={14} className="trigger-chevron" />
            </button>

            {isOpen && (
                <div className="name-color-dropdown">
                    {/* Mode tabs */}
                    <div className="color-mode-tabs">
                        <button
                            className={`color-mode-tab ${localMode === 'none' ? 'active' : ''}`}
                            onClick={() => handleModeChange('none')}
                            type="button"
                        >
                            None
                        </button>
                        <button
                            className={`color-mode-tab ${localMode === 'solid' ? 'active' : ''}`}
                            onClick={() => handleModeChange('solid')}
                            type="button"
                        >
                            Solid
                        </button>
                        <button
                            className={`color-mode-tab ${localMode === 'gradient' ? 'active' : ''}`}
                            onClick={() => handleModeChange('gradient')}
                            type="button"
                        >
                            Gradient
                        </button>
                    </div>

                    {/* Solid color picker */}
                    {localMode === 'solid' && (
                        <div className="solid-color-section">
                            <div className="color-input-wrapper" style={{ background: localColor }}>
                                <input
                                    type="color"
                                    value={localColor}
                                    onChange={(e) => handleSolidColorChange(e.target.value)}
                                />
                            </div>
                            <input
                                className="hex-input"
                                value={localColor}
                                onChange={(e) => {
                                    const v = e.target.value;
                                    setLocalColor(v);
                                    if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                                        emitChange('solid', v, localGradient);
                                    }
                                }}
                                placeholder="#6366f1"
                            />
                        </div>
                    )}

                    {/* Gradient editor */}
                    {localMode === 'gradient' && (
                        <div className="gradient-section">
                            {/* Live preview bar */}
                            <div
                                className="gradient-preview-bar"
                                style={{ background: buildGradientCSS(localGradient.stops, localGradient.angle) }}
                            />

                            {/* Color stops */}
                            <div className="gradient-stops">
                                {localGradient.stops.map((stop, i) => (
                                    <div key={i} className="gradient-stop">
                                        <div className="color-input-wrapper" style={{ background: stop.color }}>
                                            <input
                                                type="color"
                                                value={stop.color}
                                                onChange={(e) => handleStopColorChange(i, e.target.value)}
                                            />
                                        </div>
                                        <input
                                            className="hex-input"
                                            value={stop.color}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                const newStops = [...localGradient.stops];
                                                newStops[i] = { ...newStops[i], color: v };
                                                setLocalGradient({ ...localGradient, stops: newStops });
                                                if (/^#[0-9a-fA-F]{6}$/.test(v)) {
                                                    emitChange('gradient', localColor, { ...localGradient, stops: newStops });
                                                }
                                            }}
                                            style={{ flex: 1 }}
                                        />
                                        <input
                                            className="stop-position-input"
                                            type="number"
                                            min={0}
                                            max={100}
                                            value={stop.position}
                                            onChange={(e) => handleStopPositionChange(i, parseInt(e.target.value) || 0)}
                                        />
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>%</span>
                                        {localGradient.stops.length > 2 && (
                                            <button
                                                className="stop-remove-btn"
                                                onClick={() => removeStop(i)}
                                                type="button"
                                                title="Remove stop"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            <button className="add-stop-btn" onClick={addStop} type="button">
                                <Plus size={12} />
                                Add Color Stop
                            </button>

                            {/* Angle slider */}
                            <div className="angle-control">
                                <span className="angle-label">Angle</span>
                                <input
                                    className="angle-slider"
                                    type="range"
                                    min={0}
                                    max={360}
                                    value={localGradient.angle}
                                    onChange={(e) => handleAngleChange(parseInt(e.target.value))}
                                />
                                <span className="angle-value">{localGradient.angle}°</span>
                            </div>
                        </div>
                    )}

                    {/* Reset */}
                    {colorMode && (
                        <button className="name-color-reset" onClick={handleReset} type="button">
                            <RotateCcw size={12} />
                            Reset to Default
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default NameColorPicker;
