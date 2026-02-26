import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown, RotateCcw, Upload } from 'lucide-react';
import { FONT_OPTIONS, loadGoogleFont, loadFontFromData } from '../fontLoader.ts';
import { subsetFontForText, bufferToBase64, storeLocalFontSource } from '../fontSubset.ts';
import './FontPicker.css';

interface FontChange {
    nameFont: string | undefined;
    nameFontData: string | undefined;
}

interface Props {
    value: string | undefined;
    customData: string | undefined;
    username: string;
    onChange: (change: FontChange) => void;
}

const FontPicker: React.FC<Props> = ({ value, customData, username, onChange }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [isSubsetting, setIsSubsetting] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load all Google Fonts for preview when dropdown opens
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

    // Group Google Font options by category
    const grouped = FONT_OPTIONS.reduce<Record<string, typeof FONT_OPTIONS>>((acc, opt) => {
        if (!acc[opt.category]) acc[opt.category] = [];
        acc[opt.category].push(opt);
        return acc;
    }, {});

    const handleGoogleFontSelect = (fontName: string) => {
        onChange({ nameFont: fontName, nameFontData: undefined });
        setIsOpen(false);
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsSubsetting(true);
        try {
            const arrayBuffer = await file.arrayBuffer();
            const fullBuffer = new Uint8Array(arrayBuffer);

            // Store full font locally for re-subsetting when name changes
            storeLocalFontSource(fullBuffer, file.name);

            // Subset to only the username characters
            const text = username || 'A';
            const subset = await subsetFontForText(fullBuffer, text);
            const base64 = bufferToBase64(subset);

            // Derive a display name from the filename
            const fontName = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').replace(/[-_]/g, ' ');

            // Load it immediately for preview
            loadFontFromData(fontName, base64);

            onChange({ nameFont: fontName, nameFontData: base64 });
            setIsOpen(false);
        } catch (err) {
            console.error('Failed to subset font:', err);
            alert('Failed to process font file. Please try a different .ttf, .otf, or .woff2 file.');
        } finally {
            setIsSubsetting(false);
            // Reset file input so the same file can be re-selected
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleReset = () => {
        onChange({ nameFont: undefined, nameFontData: undefined });
        setIsOpen(false);
    };

    const isCustomFont = !!customData;

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
                    {value ? `${value}${isCustomFont ? ' (custom)' : ''}` : 'Default'}
                </span>
                <ChevronDown size={14} className="trigger-chevron" />
            </button>

            {isOpen && (
                <div className="font-picker-dropdown">
                    {/* Upload custom font */}
                    <div className="font-picker-category">Custom Font</div>
                    <button
                        className="font-picker-option font-picker-upload"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isSubsetting}
                        type="button"
                    >
                        <Upload size={14} />
                        {isSubsetting ? 'Processing...' : 'Upload Font File'}
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".ttf,.otf,.woff,.woff2"
                        onChange={handleFileUpload}
                        style={{ display: 'none' }}
                    />

                    {/* Google Fonts */}
                    {Object.entries(grouped).map(([category, fonts]) => (
                        <React.Fragment key={category}>
                            <div className="font-picker-category">{category}</div>
                            {fonts.map((font) => (
                                <button
                                    key={font.name}
                                    className={`font-picker-option ${value === font.name && !isCustomFont ? 'selected' : ''}`}
                                    style={{ fontFamily: `'${font.name}', sans-serif` }}
                                    onClick={() => handleGoogleFontSelect(font.name)}
                                    type="button"
                                >
                                    {font.name}
                                </button>
                            ))}
                        </React.Fragment>
                    ))}

                    {/* Reset */}
                    {value && (
                        <button
                            className="font-picker-reset"
                            onClick={handleReset}
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
