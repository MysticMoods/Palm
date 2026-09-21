export type FilesView = 'files' | 'trash' | 'local';
export type ViewMode = 'grid' | 'list';

export interface FilesParams {
  path?: string;
  view?: FilesView;
  /** Open the properties dialog for this node id on launch. */
  properties?: string;
}
