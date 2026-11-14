export type JobStatus = 'pending' | 'working' | 'ok' | 'failed';
export type JobStage = 'queued' | 'search' | 'reviews' | 'websites' | 'done';

export interface JobProgress {
  keywords_done: number;
  keywords_total: number;
  places: number;
  percent: number;
  stage: JobStage;
  reviews_done?: number;
  reviews_total?: number;
  websites_done?: number;
  websites_total?: number;
}

export interface JobData {
  keywords: string[];
  lang: string;
  country: string;
  lat: string;
  lon: string;
  zoom: number;
  radius: number;
  depth: number;
  max_time: number;
  grid: number;
  fast_mode: boolean;
  email: boolean;
  verify_emails: boolean;
  socials: boolean;
  tech: boolean;
  browser_sites: boolean;
  reviews_max: number;
  proxies: string[];
}

export interface JobRecord {
  ID: string;
  Name: string;
  Date: string;
  Status: JobStatus;
  Data: JobData;
  Error: string;
  Progress: JobProgress;
}

export interface PlaceRow {
  input_id: string;
  link: string;
  title: string;
  category: string;
  categories?: string;
  address: string;
  open_hours: string;
  popular_times: string;
  website: string;
  phone: string;
  plus_code: string;
  review_count: string;
  review_rating: string;
  reviews_per_rating: string;
  latitude: string;
  longitude: string;
  cid: string;
  status: string;
  descriptions: string;
  reviews_link: string;
  thumbnail: string;
  timezone: string;
  price_range: string;
  data_id: string;
  street_view_url: string;
  place_id: string;
  images: string;
  reservations: string;
  order_online: string;
  menu: string;
  owner: string;
  complete_address: string;
  credit_cards_accepted: string;
  about: string;
  user_reviews: string;
  user_reviews_extended: string;
  emails: string;
  email_host?: string;
  instagram?: string;
  facebook?: string;
  linkedin?: string;
  tiktok?: string;
  youtube?: string;
  x?: string;
  fb_pixel?: string;
  google_ads_tag?: string;
  analytics?: string;
  bing_ads?: string;
  linkedin_insight?: string;
  tiktok_pixel?: string;
  cms?: string;
  mobile_friendly?: string;
  intent_score?: number;
}

export interface CityPreset {
  label: string;
  lat: string;
  lon: string;
  country: string;
}

export interface GridCell {
  lat: string;
  lon: string;
  radius: number;
  zoom: number;
  bbox: [number, number, number, number];
}
