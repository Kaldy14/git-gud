/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_VERSION: string;
  readonly VITE_RELEASE_NOTES: import('@shared/changelog').ReleaseNotes;
}
