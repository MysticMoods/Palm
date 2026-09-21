export type FilesView = 'files' | 'trash' | 'disk';
export type ViewMode = 'grid' | 'list';

export interface FilesParams {
  path?: string;
  view?: FilesView;
  /** Starting folder within Palm Disk, when `view` is 'disk'. */
  diskPath?: string;
  /** Open the properties dialog for this node id on launch. */
  properties?: string;
}
