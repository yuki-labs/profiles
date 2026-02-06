import React from 'react';
import type { ProfileData } from '../types.ts';
import { User, Mail, MapPin, Link as LinkIcon, Plus, Trash2, Globe, Cpu } from 'lucide-react';
import './Form.css';

interface Props {
    profile: ProfileData;
    setProfile: React.Dispatch<React.SetStateAction<ProfileData>>;
}

const ProfileForm: React.FC<Props> = ({ profile, setProfile }) => {
    const handleChange = (field: keyof ProfileData, value: any) => {
        setProfile((prev) => ({ ...prev, [field]: value }));
    };

    const handleSocialChange = (index: number, field: 'platform' | 'url', value: string) => {
        const newSocials = [...profile.socials];
        newSocials[index] = { ...newSocials[index], [field]: value };
        handleChange('socials', newSocials);
    };

    const addSocial = () => {
        handleChange('socials', [...profile.socials, { platform: '', url: '' }]);
    };

    const removeSocial = (index: number) => {
        handleChange('socials', profile.socials.filter((_, i) => i !== index));
    };

    const addSkill = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            const val = e.currentTarget.value.trim();
            if (val && !profile.skills.includes(val)) {
                handleChange('skills', [...profile.skills, val]);
                e.currentTarget.value = '';
            }
        }
    };

    const removeSkill = (skill: string) => {
        handleChange('skills', profile.skills.filter((s) => s !== skill));
    };

    const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onloadend = () => {
                handleChange('avatar', reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    return (
        <div className="profile-form">
            <section className="form-group">
                <h2><User size={20} /> Personal Information</h2>
                <div className="avatar-upload">
                    <div className="avatar-preview" style={{ backgroundImage: profile.avatar ? `url(${profile.avatar})` : 'none' }}>
                        {!profile.avatar && <User size={40} />}
                    </div>
                    <div className="avatar-controls">
                        <label className="btn btn-secondary btn-sm">
                            Change Photo
                            <input type="file" accept="image/*" onChange={handleAvatarChange} style={{ display: 'none' }} />
                        </label>
                        {profile.avatar && <button className="btn btn-text btn-sm" onClick={() => handleChange('avatar', '')}>Remove</button>}
                    </div>
                </div>

                <div className="input-row">
                    <div className="input-field">
                        <label>Full Name</label>
                        <input
                            type="text"
                            value={profile.name}
                            onChange={(e) => handleChange('name', e.target.value)}
                            placeholder="e.g. John Doe"
                        />
                    </div>
                    <div className="input-field">
                        <label>Professional Title</label>
                        <input
                            type="text"
                            value={profile.title}
                            onChange={(e) => handleChange('title', e.target.value)}
                            placeholder="e.g. Lead Developer"
                        />
                    </div>
                </div>

                <div className="input-field">
                    <label>Bio</label>
                    <textarea
                        value={profile.bio}
                        onChange={(e) => handleChange('bio', e.target.value)}
                        placeholder="Tell us about yourself..."
                        rows={4}
                    />
                </div>
            </section>

            <section className="form-group">
                <h2><Mail size={20} /> Contact Details</h2>
                <div className="grid-2">
                    <div className="input-field">
                        <label><Mail size={14} /> Email</label>
                        <input
                            type="email"
                            value={profile.email}
                            onChange={(e) => handleChange('email', e.target.value)}
                            placeholder="hello@example.com"
                        />
                    </div>
                    <div className="input-field">
                        <label><MapPin size={14} /> Location</label>
                        <input
                            type="text"
                            value={profile.location}
                            onChange={(e) => handleChange('location', e.target.value)}
                            placeholder="New York, USA"
                        />
                    </div>
                    <div className="input-field full-width">
                        <label><Globe size={14} /> Website</label>
                        <input
                            type="url"
                            value={profile.website}
                            onChange={(e) => handleChange('website', e.target.value)}
                            placeholder="https://johndoe.com"
                        />
                    </div>
                </div>
            </section>

            <section className="form-group">
                <div className="header-with-action">
                    <h2><LinkIcon size={20} /> Social Links</h2>
                    <button className="btn btn-secondary btn-sm" onClick={addSocial}><Plus size={16} /> Add</button>
                </div>
                <div className="socials-list">
                    {profile.socials.map((social, index) => (
                        <div key={index} className="social-item">
                            <input
                                type="text"
                                value={social.platform}
                                onChange={(e) => handleSocialChange(index, 'platform', e.target.value)}
                                placeholder="Platform (e.g. GitHub)"
                            />
                            <input
                                type="url"
                                value={social.url}
                                onChange={(e) => handleSocialChange(index, 'url', e.target.value)}
                                placeholder="URL"
                            />
                            <button className="btn btn-icon btn-danger" onClick={() => removeSocial(index)}><Trash2 size={16} /></button>
                        </div>
                    ))}
                </div>
            </section>

            <section className="form-group">
                <h2><Cpu size={20} /> Skills</h2>
                <div className="skills-input-container">
                    <input
                        type="text"
                        onKeyDown={addSkill}
                        placeholder="Type a skill and press Enter"
                    />
                    <div className="skills-tags">
                        {profile.skills.map((skill) => (
                            <span key={skill} className="skill-tag">
                                {skill}
                                <button onClick={() => removeSkill(skill)}><Trash2 size={12} /></button>
                            </span>
                        ))}
                    </div>
                </div>
            </section>
        </div>
    );
};

export default ProfileForm;
