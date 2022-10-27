import { GetFrameworkGeneric } from './frameworks'
import { Route } from './route'
import { AnyPathParams } from './routeConfig'
import {
  AnyAllRouteInfo,
  AnyRouteInfo,
  DefaultAllRouteInfo,
  RouteInfo,
} from './routeInfo'
import { Router } from './router'
import { replaceEqualDeep, Timeout } from './utils'

export interface RouteMatch<
  TAllRouteInfo extends AnyAllRouteInfo = DefaultAllRouteInfo,
  TRouteInfo extends AnyRouteInfo = RouteInfo,
> extends Route<TAllRouteInfo, TRouteInfo> {
  matchId: string
  pathname: string
  params: AnyPathParams
  parentMatch?: RouteMatch
  childMatches: RouteMatch[]
  routeSearch: TRouteInfo['searchSchema']
  search: TRouteInfo['fullSearchSchema']
  status: 'idle' | 'loading' | 'success' | 'error'
  updatedAt?: number
  error?: unknown
  isInvalid: boolean
  getIsInvalid: () => boolean
  loaderData: TRouteInfo['loaderData']
  routeLoaderData: TRouteInfo['routeLoaderData']
  isFetching: boolean
  isPending: boolean
  __: {
    element?: GetFrameworkGeneric<'Element'> // , TRouteInfo['loaderData']>
    errorElement?: GetFrameworkGeneric<'Element'> // , TRouteInfo['loaderData']>
    catchElement?: GetFrameworkGeneric<'Element'> // , TRouteInfo['loaderData']>
    pendingElement?: GetFrameworkGeneric<'Element'> // , TRouteInfo['loaderData']>
    loadPromise?: Promise<void>
    loaderPromise?: Promise<void>
    importPromise?: Promise<void>
    elementsPromise?: Promise<void>
    dataPromise?: Promise<void>
    pendingTimeout?: Timeout
    pendingMinTimeout?: Timeout
    pendingMinPromise?: Promise<void>
    onExit?:
      | void
      | ((matchContext: {
          params: TRouteInfo['allParams']
          search: TRouteInfo['fullSearchSchema']
        }) => void)
    abortController: AbortController
    latestId: string
    // setParentMatch: (parentMatch: RouteMatch) => void
    // addChildMatch: (childMatch: RouteMatch) => void
    validate: () => void
    startPending: () => void
    cancelPending: () => void
    notify: () => void
    resolve: () => void
  }
  cancel: () => void
  load: () => Promise<void>
  invalidate: () => void
  hasLoaders: () => boolean
}

const elementTypes = [
  'element',
  'errorElement',
  'catchElement',
  'pendingElement',
] as const

export function createRouteMatch<
  TAllRouteInfo extends AnyAllRouteInfo = DefaultAllRouteInfo,
  TRouteInfo extends AnyRouteInfo = RouteInfo,
>(
  router: Router<any, any>,
  route: Route<TAllRouteInfo, TRouteInfo>,
  opts: {
    matchId: string
    params: TRouteInfo['allParams']
    pathname: string
  },
): RouteMatch<TAllRouteInfo, TRouteInfo> {
  const routeMatch: RouteMatch<TAllRouteInfo, TRouteInfo> = {
    ...route,
    ...opts,
    router,
    routeSearch: {},
    search: {},
    childMatches: [],
    status: 'idle',
    routeLoaderData: {} as TRouteInfo['routeLoaderData'],
    loaderData: {} as TRouteInfo['loaderData'],
    isPending: false,
    isFetching: false,
    isInvalid: false,
    getIsInvalid: () => {
      const now = Date.now()
      const maxAge =
        routeMatch.options.loaderMaxAge ??
        router.options.defaultLoaderMaxAge ??
        0
      return routeMatch.isInvalid || routeMatch.updatedAt! + maxAge < now
    },
    __: {
      abortController: new AbortController(),
      latestId: '',
      resolve: () => {},
      notify: () => {
        routeMatch.__.resolve()
        routeMatch.router.notify()
      },
      startPending: () => {
        const pendingMs =
          routeMatch.options.pendingMs ?? router.options.defaultPendingMs
        const pendingMinMs =
          routeMatch.options.pendingMinMs ?? router.options.defaultPendingMinMs

        if (
          routeMatch.__.pendingTimeout ||
          routeMatch.status !== 'loading' ||
          typeof pendingMs === 'undefined'
        ) {
          return
        }

        routeMatch.__.pendingTimeout = setTimeout(() => {
          routeMatch.isPending = true
          routeMatch.__.resolve()
          if (typeof pendingMinMs !== 'undefined') {
            routeMatch.__.pendingMinPromise = new Promise(
              (r) =>
                (routeMatch.__.pendingMinTimeout = setTimeout(r, pendingMinMs)),
            )
          }
        }, pendingMs)
      },
      cancelPending: () => {
        routeMatch.isPending = false
        clearTimeout(routeMatch.__.pendingTimeout)
        clearTimeout(routeMatch.__.pendingMinTimeout)
        delete routeMatch.__.pendingMinPromise
      },
      // setParentMatch: (parentMatch?: RouteMatch) => {
      //   routeMatch.parentMatch = parentMatch
      // },
      // addChildMatch: (childMatch: RouteMatch) => {
      //   if (
      //     routeMatch.childMatches.find((d) => d.matchId === childMatch.matchId)
      //   ) {
      //     return
      //   }

      //   routeMatch.childMatches.push(childMatch)
      // },
      validate: () => {
        // Validate the search params and stabilize them
        const parentSearch =
          routeMatch.parentMatch?.search ?? router.location.search

        try {
          const prevSearch = routeMatch.routeSearch

          const validator =
            typeof routeMatch.options.validateSearch === 'object'
              ? routeMatch.options.validateSearch.parse
              : routeMatch.options.validateSearch

          let nextSearch = replaceEqualDeep(
            prevSearch,
            validator?.(parentSearch),
          )

          // Invalidate route matches when search param stability changes
          if (prevSearch !== nextSearch) {
            routeMatch.isInvalid = true
          }

          routeMatch.routeSearch = nextSearch

          routeMatch.search = replaceEqualDeep(parentSearch, {
            ...parentSearch,
            ...nextSearch,
          })
        } catch (err: any) {
          console.error(err)
          const error = new (Error as any)('Invalid search params found', {
            cause: err,
          })
          error.code = 'INVALID_SEARCH_PARAMS'
          routeMatch.status = 'error'
          routeMatch.error = error
          // Do not proceed with loading the route
          return
        }
      },
    },
    cancel: () => {
      routeMatch.__.abortController?.abort()
      routeMatch.__.cancelPending()
    },
    invalidate: () => {
      routeMatch.isInvalid = true
    },
    hasLoaders: () => {
      return !!(
        route.options.loader ||
        route.options.import ||
        elementTypes.some((d) => typeof route.options[d] === 'function')
      )
    },
    load: async () => {
      const id = '' + Date.now() + Math.random()
      routeMatch.__.latestId = id

      // If the match was in an error state, set it
      // to a loading state again. Otherwise, keep it
      // as loading or resolved
      if (routeMatch.status === 'idle') {
        routeMatch.status = 'loading'
      }

      // We started loading the route, so it's no longer invalid
      routeMatch.isInvalid = false

      routeMatch.__.loadPromise = new Promise(async (resolve) => {
        // We are now fetching, even if it's in the background of a
        // resolved state
        routeMatch.isFetching = true
        routeMatch.__.resolve = resolve as () => void

        const loaderPromise = (async () => {
          const importer = routeMatch.options.import

          // First, run any importers
          if (importer) {
            routeMatch.__.importPromise = importer({
              params: routeMatch.params,
              // search: routeMatch.search,
            }).then((imported) => {
              routeMatch.__ = {
                ...routeMatch.__,
                ...imported,
              }
            })
          }

          // Wait for the importer to finish before
          // attempting to load elements and data
          await routeMatch.__.importPromise

          // Next, load the elements and data in parallel

          routeMatch.__.elementsPromise = (async () => {
            // then run all element and data loaders in parallel
            // For each element type, potentially load it asynchronously

            await Promise.all(
              elementTypes.map(async (type) => {
                const routeElement = routeMatch.options[type]

                if (routeMatch.__[type]) {
                  return
                }

                if (typeof routeElement === 'function') {
                  const res = await (routeElement as any)(routeMatch)

                  routeMatch.__[type] = res
                } else {
                  routeMatch.__[type] = routeMatch.options[type] as any
                }
              }),
            )
          })()

          routeMatch.__.dataPromise = Promise.resolve().then(async () => {
            try {
              if (routeMatch.options.loader) {
                const data = await routeMatch.options.loader({
                  params: routeMatch.params,
                  search: routeMatch.routeSearch,
                  signal: routeMatch.__.abortController.signal,
                })
                if (id !== routeMatch.__.latestId) {
                  return routeMatch.__.loaderPromise
                }

                routeMatch.routeLoaderData = replaceEqualDeep(
                  routeMatch.routeLoaderData,
                  data,
                )
              }

              routeMatch.error = undefined
              routeMatch.status = 'success'
              routeMatch.updatedAt = Date.now()
            } catch (err) {
              if (id !== routeMatch.__.latestId) {
                return routeMatch.__.loaderPromise
              }

              if (process.env.NODE_ENV !== 'production') {
                console.error(err)
              }
              routeMatch.error = err
              routeMatch.status = 'error'
              routeMatch.updatedAt = Date.now()
            }
          })

          try {
            await Promise.all([
              routeMatch.__.elementsPromise,
              routeMatch.__.dataPromise,
            ])
            if (id !== routeMatch.__.latestId) {
              return routeMatch.__.loaderPromise
            }

            if (routeMatch.__.pendingMinPromise) {
              await routeMatch.__.pendingMinPromise
              delete routeMatch.__.pendingMinPromise
            }
          } finally {
            if (id !== routeMatch.__.latestId) {
              return routeMatch.__.loaderPromise
            }
            routeMatch.__.cancelPending()
            routeMatch.isPending = false
            routeMatch.isFetching = false
            routeMatch.__.notify()
          }
        })()

        routeMatch.__.loaderPromise = loaderPromise
        await loaderPromise

        if (id !== routeMatch.__.latestId) {
          return routeMatch.__.loaderPromise
        }
        delete routeMatch.__.loaderPromise
      })

      return await routeMatch.__.loadPromise
    },
  }

  if (!routeMatch.hasLoaders()) {
    routeMatch.status = 'success'
  }

  return routeMatch
}