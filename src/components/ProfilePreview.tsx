import React, { useRef, useEffect } from 'react';
import type { ProfileData } from '../types.ts';
import { Mail, MapPin, Globe, ExternalLink, Github, Twitter, Linkedin, Instagram, Camera, Plus, Trash2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { loadGoogleFont } from '../fontLoader.ts';
import FontPicker from './FontPicker.tsx';
import './Preview.css';

interface Props {
    profile: ProfileData;
    setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
    readonly?: boolean;
}

const getSocialIcon = (platform: string) => {
    const p = platform.toLowerCase();
    if (p.includes('github')) return <Github size={18} />;
    if (p.includes('twitter')) return <Twitter size={18} />;
    if (p.includes('linkedin')) return <Linkedin size={18} />;
    if (p.includes('instagram')) return <Instagram size={18} />;
    return <ExternalLink size={18} />;
};

const ProfilePreview: React.FC<Props> = ({ profile, setProfile, readonly = false }) => {
    const avatarInputRef = useRef<HTMLInputElement>(null);

    // Load the custom font on mount / when it changes
    useEffect(() => {
        loadGoogleFont(profile.theme.nameFont);
    }, [profile.theme.nameFont]);

    const nameFontStyle = profile.theme.nameFont
        ? { fontFamily: `'${profile.theme.nameFont}', sans-serif` }
        : {};

    const updateProfile = (field: keyof ProfileData, value: any) => {
        setProfile((prev) => ({ ...prev, [field]: value }));
    };

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                updateProfile('avatar', reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSocialChange = (index: number, field: 'platform' | 'url', value: string) => {
        const newSocials = [...profile.socials];
        newSocials[index] = { ...newSocials[index], [field]: value };
        updateProfile('socials', newSocials);
    };

    const addSocial = () => {
        updateProfile('socials', [...profile.socials, { platform: 'GitHub', url: '' }]);
    };

    const removeSocial = (index: number) => {
        updateProfile('socials', profile.socials.filter((_, i) => i !== index));
    };

    const addSkill = () => {
        const skill = prompt('Enter a new skill:');
        if (skill && !profile.skills.includes(skill)) {
            updateProfile('skills', [...profile.skills, skill]);
        }
    };

    const removeSkill = (skill: string) => {
        updateProfile('skills', profile.skills.filter((s) => s !== skill));
    };

    return (
        <div className="preview-card-container">
            <motion.div
                className={`preview-card ${!readonly ? 'edit-mode' : 'view-mode'}`}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5 }}
            >
                <div className="card-header" style={{ borderColor: profile.theme.primaryColor }}>
                    <div className="card-avatar" onClick={() => !readonly && avatarInputRef.current?.click()}>
                        {profile.avatar ? (
                            <img src={profile.avatar} alt={profile.name} />
                        ) : (
                            <div className="avatar-placeholder">{profile.name?.[0] || '?'}</div>
                        )}
                        {!readonly && (
                            <div className="avatar-overlay">
                                <Camera size={24} />
                            </div>
                        )}
                        {!readonly && (
                            <input
                                type="file"
                                ref={avatarInputRef}
                                onChange={handleAvatarChange}
                                accept="image/*"
                                style={{ display: 'none' }}
                            />
                        )}
                    </div>

                    <div className="header-info">
                        {readonly ? (
                            <h1 className="preview-name" style={nameFontStyle}>{profile.name || 'Your Name'}</h1>
                        ) : (
                            <>
                                <input
                                    className="wysiwyg-input preview-name"
                                    value={profile.name}
                                    onChange={(e) => updateProfile('name', e.target.value)}
                                    placeholder="Your Name"
                                    style={nameFontStyle}
                                />
                                <FontPicker
                                    value={profile.theme.nameFont}
                                    onChange={(font) => setProfile((prev) => ({
                                        ...prev,
                                        theme: { ...prev.theme, nameFont: font }
                                    }))}
                                />
                            </>
                        )}
                        {readonly ? (
                            <p className="preview-title" style={{ color: profile.theme.primaryColor }}>{profile.title || 'Professional Title'}</p>
                        ) : (
                            <input
                                className="wysiwyg-input preview-title"
                                value={profile.title}
                                onChange={(e) => updateProfile('title', e.target.value)}
                                placeholder="Professional Title"
                                style={{ color: profile.theme.primaryColor }}
                            />
                        )}
                    </div>
                </div>

                <div className="card-body">
                    <div className="preview-section">
                        {readonly ? (
                            <p className="preview-bio">{profile.bio || 'No bio provided'}</p>
                        ) : (
                            <textarea
                                className="wysiwyg-textarea preview-bio"
                                value={profile.bio}
                                onChange={(e) => updateProfile('bio', e.target.value)}
                                placeholder="Write your bio here..."
                                rows={3}
                            />
                        )}
                    </div>

                    <div className="preview-meta">
                        <div className="meta-item">
                            <MapPin size={16} />
                            {readonly ? (
                                <span>{profile.location || 'Unknown Location'}</span>
                            ) : (
                                <input
                                    className="wysiwyg-input-sm"
                                    value={profile.location}
                                    onChange={(e) => updateProfile('location', e.target.value)}
                                    placeholder="Location"
                                />
                            )}
                        </div>
                        <div className="meta-item">
                            <Mail size={16} />
                            {readonly ? (
                                <span>{profile.email || 'No email provided'}</span>
                            ) : (
                                <input
                                    className="wysiwyg-input-sm"
                                    value={profile.email}
                                    onChange={(e) => updateProfile('email', e.target.value)}
                                    placeholder="Email Address"
                                />
                            )}
                        </div>
                        <div className="meta-item">
                            <Globe size={16} />
                            {readonly ? (
                                profile.website ? (
                                    <a href={profile.website} target="_blank" rel="noopener noreferrer">
                                        {profile.website.replace(/^https?:\/\//, '')}
                                    </a>
                                ) : <span>No website</span>
                            ) : (
                                <input
                                    className="wysiwyg-input-sm"
                                    value={profile.website}
                                    onChange={(e) => updateProfile('website', e.target.value)}
                                    placeholder="Website URL"
                                />
                            )}
                        </div>
                    </div>

                    <div className="preview-section">
                        <div className="section-header-inline">
                            <h3 className="section-title">Skills</h3>
                            {!readonly && <button className="btn-add-inline" onClick={addSkill}><Plus size={14} /></button>}
                        </div>
                        <div className="preview-skills">
                            {profile.skills?.map((skill) => (
                                <span
                                    key={skill}
                                    className={`preview-skill-tag ${!readonly ? 'editable-tag' : ''}`}
                                    style={{ background: `${profile.theme.primaryColor}20`, color: profile.theme.primaryColor }}
                                >
                                    {skill}
                                    {!readonly && (
                                        <button className="btn-remove-tag" onClick={() => removeSkill(skill)}><Trash2 size={10} /></button>
                                    )}
                                </span>
                            ))}
                            {!profile.skills?.length && !readonly && <span className="empty-hint">Add your skills...</span>}
                        </div>
                    </div>

                    <div className="preview-section">
                        <div className="section-header-inline">
                            <h3 className="section-title">Socials</h3>
                            {!readonly && <button className="btn-add-inline" onClick={addSocial}><Plus size={14} /></button>}
                        </div>
                        <div className="preview-socials">
                            {profile.socials?.map((social, index) => (
                                readonly ? (
                                    <a
                                        key={index}
                                        href={social.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="social-button"
                                        style={{ '--hover-color': profile.theme.primaryColor } as any}
                                    >
                                        {getSocialIcon(social.platform)}
                                        <span>{social.platform}</span>
                                    </a>
                                ) : (
                                    <div key={index} className="social-edit-item">
                                        <div className="social-button" style={{ '--hover-color': profile.theme.primaryColor } as any}>
                                            {getSocialIcon(social.platform)}
                                            <input
                                                className="wysiwyg-input-social"
                                                value={social.platform}
                                                onChange={(e) => handleSocialChange(index, 'platform', e.target.value)}
                                                placeholder="Platform"
                                            />
                                        </div>
                                        <input
                                            className="wysiwyg-input-url"
                                            value={social.url}
                                            onChange={(e) => handleSocialChange(index, 'url', e.target.value)}
                                            placeholder="Profile URL"
                                        />
                                        <button className="btn-remove-social" onClick={() => removeSocial(index)}><Trash2 size={14} /></button>
                                    </div>
                                )
                            ))}
                            {!profile.socials?.length && !readonly && <span className="empty-hint">Add your social links...</span>}
                        </div>
                    </div>
                </div>

                {profile.id && (
                    <div className="card-footer">
                        <span className="profile-id-label">ID</span>
                        <code className="profile-id-value">{profile.id}</code>
                        <button
                            className="btn-copy-id"
                            onClick={() => {
                                navigator.clipboard.writeText(profile.id);
                            }}
                            title="Copy profile ID"
                        >
                            Copy
                        </button>
                    </div>
                )}
            </motion.div>
        </div>
    );
};

export default ProfilePreview;
