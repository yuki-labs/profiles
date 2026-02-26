declare module 'subset-font' {
    interface SubsetOptions {
        targetFormat?: 'sfnt' | 'woff' | 'woff2';
    }
    export default function subsetFont(
        fontBuffer: Buffer | Uint8Array,
        text: string,
        options?: SubsetOptions
    ): Promise<Buffer>;
}
