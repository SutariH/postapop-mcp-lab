// The contract between the MCP layer and the product.
// The tools only know this interface. In this lab, src/demo-api.ts implements it
// with mock data. In a real product, an HTTP client would implement it.

export type Network = 'Instagram' | 'LinkedIn' | 'Bluesky';

export interface Channel {
  id: string;
  network: Network;
  name: string;
}

export interface Workspace {
  name: string;
  timeZone: string;
  channels: Channel[];
}

export type PostStatus = 'draft' | 'scheduled' | 'published';

export interface Post {
  id: string;
  status: PostStatus;
  text: string;
  channelIds: string[];
  /** When the post is scheduled or was published, in UTC. Drafts have no time. */
  time: string | null;
}

export type PostListStatus = 'upcoming' | 'drafts' | 'published';

export interface PostListQuery {
  status: PostListStatus;
  from?: string;
  to?: string;
}

export interface PostList {
  window: { from: string; to: string } | null;
  posts: Post[];
}

export interface DraftInput {
  text: string;
  channelIds: string[];
}

/** Numbers for one post on one channel. null means the network has not reported the number. */
export interface ChannelResult {
  channelId: string;
  impressions: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
}

export type ResultsPeriod = 7 | 30 | 90;

export interface ResultsReport {
  from: string;
  to: string;
  posts: Array<{ post: Post; results: ChannelResult[] }>;
}

/** A picture on a post that came from one page of a design. */
export interface DesignPicture {
  kind: 'design';
  mediaId: string;
  designId: string;
  page: number;
  /** The design's updatedAt when this page was exported. */
  revision: string;
}

/** A picture on a post that came as a file from the chat. */
export interface FilePicture {
  kind: 'file';
  mediaId: string;
  /** SHA-256 of the bytes, so the same picture is never added twice. */
  sha256: string;
  fileName: string | null;
}

export type PostPicture = DesignPicture | FilePicture;

export interface DesignAttachment {
  postId: string;
  postUrl: string;
  designId: string;
  title: string;
  /** This design's pictures on the post, after the call. */
  pictures: DesignPicture[];
  /** True when the design had not changed, so nothing was exported. */
  unchanged: boolean;
  /** Pages that did not fit on the post. */
  pagesLeftOut: number[];
}

/**
 * A file the chat client handed over (the openai/fileParams shape). Only
 * download_url and file_id are always there.
 */
export interface PictureFile {
  downloadUrl: string;
  fileId: string;
  mimeType?: string;
  fileName?: string;
}

export interface FilesAttachment {
  postId: string;
  postUrl: string;
  /** Pictures new on the post, in the order they were sent. */
  added: FilePicture[];
  /** Pictures that were already on the post, so they were not added again. */
  alreadyOnPost: number;
  /** All pictures on the post after the call. */
  pictureCount: number;
}

/** One record per tool call that changes something, like a product's "What AI tools did" list. */
export interface ActivityEvent {
  tool: 'add_design_to_post' | 'add_pictures_to_post';
  postId: string;
  outcome: 'ok' | 'refused' | 'failed';
  at: string;
}

/** What a piece of material is. The kind decides how a model can read it. */
export type MaterialKind = 'article' | 'video' | 'podcast';

export type SourceKind = MaterialKind | 'note' | 'pdf';

/**
 * A link or a note the shop saved, as the AI tools may see it. Its title and
 * link went through the private-link rule, so a signed link never leaves.
 */
export interface SourceView {
  id: string;
  kind: SourceKind;
  title: string;
  /** The public link, or null: a note has none, and a private link is held back. */
  url: string | null;
  takeaway: string;
  savedAt: string;
  /** True when a post was already made from it. */
  used: boolean;
  partCount: number;
  howToRead: string;
}

/** One part of a saved source's text, fenced as outside text. */
export interface SourcePart {
  source: SourceView;
  part: number;
  partCount: number;
  /** The text between two markers that carry a code made for this answer. */
  text: string;
}

/** A post from someone the shop follows (a "voice"), from their feed. */
export interface FeedItem {
  id: string;
  voice: string;
  kind: MaterialKind;
  title: string;
  summary: string;
  url: string | null;
  publishedAt: string;
  howToRead: string;
}

export type FeedPeriod = 7 | 14 | 30;

/** Where a suggestion comes from. */
export type SuggestionPlace = 'voices' | 'sources' | 'ideas';

export interface Suggestion {
  title: string;
  place: SuggestionPlace;
  /** One line the model can tell the person: why this, why now. */
  whyNow: string;
  links: Array<{ url: string; kind: SourceKind }>;
  ids: { feedItemId?: string; sourceId?: string; ideaId?: string };
  howToRead: string;
}

export interface SchedulingApi {
  getWorkspace(): Promise<Workspace>;
  listPosts(query: PostListQuery): Promise<PostList>;
  createDraft(input: DraftInput): Promise<Post>;
  getResults(query: { days: ResultsPeriod }): Promise<ResultsReport>;
  addDesignToDraft(input: { postId: string; design: string }): Promise<DesignAttachment>;
  addPicturesToDraft(input: { postId: string; files: PictureFile[] }): Promise<FilesAttachment>;
  getActivity(): Promise<ActivityEvent[]>;
  listSources(query: { search?: string }): Promise<SourceView[]>;
  getSourcePart(query: { sourceId: string; part: number }): Promise<SourcePart>;
  listFeedItems(query: { days: FeedPeriod }): Promise<FeedItem[]>;
  getPostSuggestions(query: { count: number }): Promise<Suggestion[]>;
}

/**
 * An error the API reports on purpose, such as a bad input.
 * The message is one plain sentence that is safe to show to the model.
 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
