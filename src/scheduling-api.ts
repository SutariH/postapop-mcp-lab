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

export interface SchedulingApi {
  getWorkspace(): Promise<Workspace>;
  listPosts(query: PostListQuery): Promise<PostList>;
  createDraft(input: DraftInput): Promise<Post>;
  getResults(query: { days: ResultsPeriod }): Promise<ResultsReport>;
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
