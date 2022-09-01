import ingestNewStoriesRoute from './ingest/new-stories'
import ingestStoryActivityRoute from './ingest/story-activity'
import generateNewCollectionsRoute from './generate/new-collections'

const routeOptions = {
  prefix: 'v1'
}

export {
  routeOptions,
  ingestNewStoriesRoute,
  ingestStoryActivityRoute,
  generateNewCollectionsRoute
}
