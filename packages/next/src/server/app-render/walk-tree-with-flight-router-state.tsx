import type {
  FlightDataPath,
  FlightDataSegment,
  FlightRouterState,
  PreloadCallbacks,
  Segment,
} from './types'
import {
  canSegmentBeOverridden,
  matchSegment,
} from '../../client/components/match-segments'
import type { LoaderTree } from '../lib/app-dir-module'
import { getLinkAndScriptTags } from './get-css-inlined-link-tags'
import { getPreloadableFonts } from './get-preloadable-fonts'
import { createFlightRouterStateFromLoaderTree } from './create-flight-router-state-from-loader-tree'
import type { AppRenderContext } from './app-render'
import { hasLoadingComponentInTree } from './has-loading-component-in-tree'
import {
  DEFAULT_SEGMENT_KEY,
  addSearchParamsIfPageSegment,
} from '../../shared/lib/segment'
import { createComponentTree } from './create-component-tree'

/**
 * Use router state to decide at what common layout to render the page.
 * This can either be the common layout between two pages or a specific place to start rendering from using the "refetch" marker in the tree.
 */
export async function walkTreeWithFlightRouterState({
  loaderTreeToFilter,
  parentParams,
  flightRouterState,
  parentRendered,
  rscPayloadHead,
  injectedCSS,
  injectedJS,
  injectedFontPreloadTags,
  rootLayoutIncluded,
  getMetadataReady,
  ctx,
  preloadCallbacks,
}: {
  loaderTreeToFilter: LoaderTree
  parentParams: { [key: string]: string | string[] }
  flightRouterState?: FlightRouterState
  parentRendered?: boolean
  rscPayloadHead: React.ReactNode
  injectedCSS: Set<string>
  injectedJS: Set<string>
  injectedFontPreloadTags: Set<string>
  rootLayoutIncluded: boolean
  getMetadataReady: () => Promise<void>
  ctx: AppRenderContext
  preloadCallbacks: PreloadCallbacks
}): Promise<FlightDataPath[]> {
  const {
    renderOpts: { nextFontManifest, experimental },
    query,
    isPrefetch,
    getDynamicParamFromSegment,
    parsedRequestHeaders,
  } = ctx

  const [segment, parallelRoutes, modules] = loaderTreeToFilter

  const parallelRoutesKeys = Object.keys(parallelRoutes)

  const { layout } = modules
  const isLayout = typeof layout !== 'undefined'

  /**
   * Checks if the current segment is a root layout.
   */
  const rootLayoutAtThisLevel = isLayout && !rootLayoutIncluded
  /**
   * Checks if the current segment or any level above it has a root layout.
   */
  const rootLayoutIncludedAtThisLevelOrAbove =
    rootLayoutIncluded || rootLayoutAtThisLevel

  // Because this function walks to a deeper point in the tree to start rendering we have to track the dynamic parameters up to the point where rendering starts
  const segmentParam = getDynamicParamFromSegment(segment)
  const currentParams =
    // Handle null case where dynamic param is optional
    segmentParam && segmentParam.value !== null
      ? {
          ...parentParams,
          [segmentParam.param]: segmentParam.value,
        }
      : parentParams
  const actualSegment: Segment = addSearchParamsIfPageSegment(
    segmentParam ? segmentParam.treeSegment : segment,
    query
  )

  /**
   * Decide if the current segment is where rendering has to start.
   */
  const renderComponentsOnThisLevel =
    // No further router state available
    !flightRouterState ||
    // Segment in router state does not match current segment
    !matchSegment(actualSegment, flightRouterState[0]) ||
    // Last item in the tree
    parallelRoutesKeys.length === 0 ||
    // Explicit refresh
    flightRouterState[3] === 'refetch'

  // Pre-PPR, the `loading` component signals to the router how deep to render the component tree
  // to ensure prefetches are quick and inexpensive. If there's no `loading` component anywhere in the tree being rendered,
  // the prefetch will be short-circuited to avoid requesting a potentially very expensive subtree. If there's a `loading`
  // somewhere in the tree, we'll recursively render the component tree up until we encounter that loading component, and then stop.
  const shouldSkipComponentTree =
    !experimental.isRoutePPREnabled &&
    // If PPR is disabled, and this is a request for the route tree, then we
    // never render any components. Only send the router state.
    (parsedRequestHeaders.isRouteTreePrefetchRequest ||
      // Otherwise, check for the presence of a `loading` component.
      (isPrefetch &&
        !Boolean(modules.loading) &&
        !hasLoadingComponentInTree(loaderTreeToFilter)))

  if (!parentRendered && renderComponentsOnThisLevel) {
    const overriddenSegment =
      flightRouterState &&
      canSegmentBeOverridden(actualSegment, flightRouterState[0])
        ? flightRouterState[0]
        : actualSegment

    const routerState = createFlightRouterStateFromLoaderTree(
      // Create router state using the slice of the loaderTree
      loaderTreeToFilter,
      getDynamicParamFromSegment,
      query
    )

    if (shouldSkipComponentTree) {
      // Send only the router state.
      // TODO: Even for a dynamic route, we should cache these responses,
      // because they do not contain any render data (neither segment data nor
      // the head). They can be made even more cacheable once we move the route
      // params into a separate data structure.
      return [
        [
          overriddenSegment,
          routerState,
          null,
          null,
          false,
        ] satisfies FlightDataSegment,
      ]
    } else {
      // Create component tree using the slice of the loaderTree
      const seedData = await createComponentTree(
        // This ensures flightRouterPath is valid and filters down the tree
        {
          ctx,
          loaderTree: loaderTreeToFilter,
          parentParams: currentParams,
          injectedCSS,
          injectedJS,
          injectedFontPreloadTags,
          // This is intentionally not "rootLayoutIncludedAtThisLevelOrAbove" as createComponentTree starts at the current level and does a check for "rootLayoutAtThisLevel" too.
          rootLayoutIncluded,
          getMetadataReady,
          preloadCallbacks,
          authInterrupts: experimental.authInterrupts,
        }
      )

      return [
        [
          overriddenSegment,
          routerState,
          seedData,
          rscPayloadHead,
          false,
        ] satisfies FlightDataSegment,
      ]
    }
  }

  // If we are not rendering on this level we need to check if the current
  // segment has a layout. If so, we need to track all the used CSS to make
  // the result consistent.
  const layoutPath = layout?.[1]
  const injectedCSSWithCurrentLayout = new Set(injectedCSS)
  const injectedJSWithCurrentLayout = new Set(injectedJS)
  const injectedFontPreloadTagsWithCurrentLayout = new Set(
    injectedFontPreloadTags
  )
  if (layoutPath) {
    getLinkAndScriptTags(
      ctx.clientReferenceManifest,
      layoutPath,
      injectedCSSWithCurrentLayout,
      injectedJSWithCurrentLayout,
      true
    )
    getPreloadableFonts(
      nextFontManifest,
      layoutPath,
      injectedFontPreloadTagsWithCurrentLayout
    )
  }

  const paths: FlightDataPath[] = []

  // Walk through all parallel routes.
  for (const parallelRouteKey of parallelRoutesKeys) {
    const parallelRoute = parallelRoutes[parallelRouteKey]

    const subPaths = await walkTreeWithFlightRouterState({
      ctx,
      loaderTreeToFilter: parallelRoute,
      parentParams: currentParams,
      flightRouterState:
        flightRouterState && flightRouterState[1][parallelRouteKey],
      parentRendered: parentRendered || renderComponentsOnThisLevel,
      rscPayloadHead,
      injectedCSS: injectedCSSWithCurrentLayout,
      injectedJS: injectedJSWithCurrentLayout,
      injectedFontPreloadTags: injectedFontPreloadTagsWithCurrentLayout,
      rootLayoutIncluded: rootLayoutIncludedAtThisLevelOrAbove,
      getMetadataReady,
      preloadCallbacks,
    })

    for (const subPath of subPaths) {
      // we don't need to send over default routes in the flight data
      // because they are always ignored by the client, unless it's a refetch
      if (
        subPath[0] === DEFAULT_SEGMENT_KEY &&
        flightRouterState &&
        !!flightRouterState[1][parallelRouteKey][0] &&
        flightRouterState[1][parallelRouteKey][3] !== 'refetch'
      ) {
        continue
      }

      paths.push([actualSegment, parallelRouteKey, ...subPath])
    }
  }

  return paths
}