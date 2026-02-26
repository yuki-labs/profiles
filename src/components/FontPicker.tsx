import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, RotateCcw } from 'lucide-react';
import { FONT_OPTIONS, loadGoogleFont } from '../fontLoader.ts';
import './FontPicker.css';

interface Props {
    value: string | undefined;
    onChange: (fontName: string | undefined) => void;
}

const FontPicker: React.FC<Props> = ({ value, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Load all fonts for preview when dropdown opens
    useEffect(() => {
        if (isOpen) {
            FONT_OPTIONS.forEach(opt => loadGoogleFont(opt.name));
        }
    }, [isOpen]);

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

    // Group options by category
    const grouped = FONT_OPTIONS.reduce<Record<string, typeof FONT_OPTIONS>>((acc, opt) => {
        if (!acc[opt.category]) acc[opt.category] = [];
        acc[opt.category].push(opt);
        return acc;
    }, {});

    return (
        <div className="font-picker" ref={containerRef}>
            <button
                className={`font-picker-trigger ${isOpen ? 'open' : ''}`}
                onClick={() => setIsOpen(!isOpen)}
                type="button"
            >
                <span className="trigger-label">Font</span>
                <span
                    className="trigger-value"
                    style={{ fontFamily: value ? `'${value}', sans-serif` : 'inherit' }}
                >
                    {value || 'Default'}
                </span>
                <ChevronDown size={14} className="trigger-chevron" />
            </button>

            {isOpen && (
                <div className="font-picker-dropdown">
                    {Object.entries(grouped).map(([category, fonts]) => (
                        <React.Fragment key={category}>
                            <div className="font-picker-category">{category}</div>
                            {fonts.map((font) => (
                                <button
                                    key={font.name}
                                    className={`font-picker-option ${value === font.name ? 'selected' : ''}`}
                                    style={{ fontFamily: `'${font.name}', sans-serif` }}
                                    onClick={() => {
                                        onChange(font.name);
                                        setIsOpen(false);
                                    }}
                                    type="button"
                                >
                                    {font.name}
                                </button>
                            ))}
                        </React.Fragment>
                    ))}
                    {value && (
                        <button
                            className="font-picker-reset"
                            onClick={() => {
                                onChange(undefined);
                                setIsOpen(false);
                            }}
                            type="button"
                        >
                            <RotateCcw size={12} />
                            Reset to Default
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default FontPicker;
