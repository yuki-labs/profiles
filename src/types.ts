export interface ProfileData {
    name: string;
    title: string;
    bio: string;
    avatar: string;
    email: string;
    location: string;
    website: string;
    socials: {
        platform: string;
        url: string;
    }[];
    skills: string[];
    appName?: string;
    theme: {
        primaryColor: string;
        darkMode: boolean;
    };
}

export const defaultProfile: ProfileData = {
    name: '',
    title: '',
    bio: '',
    avatar: '',
    email: '',
    location: '',
    website: '',
    socials: [],
    skills: [],
    theme: {
        primaryColor: '#6366f1',
        darkMode: true,
    },
};
