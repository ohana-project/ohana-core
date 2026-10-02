import type { FastifyPluginAsyncTypebox, TypeBoxTypeProvider } from '@fastify/type-provider-typebox'
import { Type } from '@sinclair/typebox'
import type { FastifyInstance } from 'fastify'
import {
  type AccessDeps,
  MemberHeadersSchema,
  memberSessionGuard,
  requireMemberActor,
} from '../access/index.ts'
import { sectionGate } from '../spaces/index.ts'
import {
  toGiftFavoriteDto,
  toGiftReservationDto,
  toWishDto,
  GiftFavoriteDtoSchema,
  GiftFavoriteListDtoSchema,
  GiftReservationDtoSchema,
  GiftReservationListDtoSchema,
  WishDtoSchema,
  WishIdParamsSchema,
  WishListDtoSchema,
  WishListQuerySchema,
  WriteWishBodySchema,
} from './contracts.ts'
import {
  cancelReservation,
  clearReceived,
  createWish,
  editWish,
  favoriteWish,
  getWish,
  getWishReservation,
  listGiftFavorites,
  listGiftReservations,
  listWishes,
  markReceived,
  removeWish,
  reserveWish,
  unfavoriteWish,
  type WishlistActor,
  type WishlistDeps,
} from './service.ts'

export interface WishlistRoutesOptions {
  deps: WishlistDeps
  /** The access module's deps, for the member session guard it publishes. */
  access: AccessDeps
}

/**
 * The wishlist's member-facing routes (issue #18). The section gate follows
 * the member session guard (ADR-0011): a hidden wishlist answers 404
 * `section_hidden` for every member before any handler runs, and the write
 * use cases recheck visibility inside their transactions.
 */
export const wishlistRoutes: FastifyPluginAsyncTypebox<WishlistRoutesOptions> = async (
  app,
  opts,
) => {
  await app.register(async (memberArea: FastifyInstance) => {
    const scoped = memberArea.withTypeProvider<TypeBoxTypeProvider>()
    scoped.addHook('onRequest', memberSessionGuard(opts.access))
    scoped.addHook('onRequest', sectionGate({ db: opts.deps.db }, 'wishlist'))

    // The space's browse (issue #18): every member's wishes, creation
    // order — or one member's wishlist when the query names them. The
    // synchronised partition is the screens' read; this route is the
    // contract the tests and the OpenAPI document speak.
    scoped.get(
      '/wishlist/wishes',
      {
        schema: {
          headers: MemberHeadersSchema,
          querystring: WishListQuerySchema,
          response: { 200: WishListDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        const wishes = await listWishes(opts.deps, actor, request.query.author)
        return { wishes: wishes.map(toWishDto) }
      },
    )

    scoped.post(
      '/wishlist/wishes',
      {
        schema: {
          headers: MemberHeadersSchema,
          body: WriteWishBodySchema,
          response: { 201: WishDtoSchema },
        },
      },
      async (request, reply) => {
        const actor: WishlistActor = requireMemberActor(request)
        const wish = await createWish(opts.deps, actor, request.body)
        return reply.code(201).send(toWishDto(wish))
      },
    )

    scoped.get(
      '/wishlist/wishes/:wishId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 200: WishDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        return toWishDto(await getWish(opts.deps, actor, request.params.wishId))
      },
    )

    // The author's edit — a PUT, because it replaces the whole
    // title-details-link triple (absent details name "none", never "keep
    // the old one"); the received mark is never an input here.
    scoped.put(
      '/wishlist/wishes/:wishId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          body: WriteWishBodySchema,
          response: { 200: WishDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        return toWishDto(await editWish(opts.deps, actor, request.params.wishId, request.body))
      },
    )

    // The removal (issue #18): a wish leaves for good, the tombstone
    // carrying it out of every device's copy.
    scoped.delete(
      '/wishlist/wishes/:wishId',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: WishlistActor = requireMemberActor(request)
        await removeWish(opts.deps, actor, request.params.wishId)
        return reply.code(204).send(null)
      },
    )

    // The author's mark (issue #18): the wish stops being open.
    scoped.post(
      '/wishlist/wishes/:wishId/received',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 200: WishDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        return toWishDto(await markReceived(opts.deps, actor, request.params.wishId))
      },
    )

    // The way back to open, from the edit sheet's switch.
    scoped.delete(
      '/wishlist/wishes/:wishId/received',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 200: WishDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        return toWishDto(await clearReceived(opts.deps, actor, request.params.wishId))
      },
    )

    // The member's own gift favorites (issue #19): the one listing that
    // exists, the bookmark being private to the member who made it.
    scoped.get(
      '/wishlist/favorites',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: GiftFavoriteListDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        const favorites = await listGiftFavorites(opts.deps, actor)
        return { favorites: favorites.map(toGiftFavoriteDto) }
      },
    )

    // The private bookmark (issue #19): the member's own wish refuses, and
    // the answer goes to no one but the member who made it.
    scoped.post(
      '/wishlist/wishes/:wishId/favorite',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 201: GiftFavoriteDtoSchema },
        },
      },
      async (request, reply) => {
        const actor: WishlistActor = requireMemberActor(request)
        const favorite = await favoriteWish(opts.deps, actor, request.params.wishId)
        return reply.code(201).send(toGiftFavoriteDto(favorite))
      },
    )

    // Taking the bookmark back (issue #19).
    scoped.delete(
      '/wishlist/wishes/:wishId/favorite',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: WishlistActor = requireMemberActor(request)
        await unfavoriteWish(opts.deps, actor, request.params.wishId)
        return reply.code(204).send(null)
      },
    )

    // The reservations the requesting member may see (issue #19): every
    // member's but their own — the wish's author never sees one.
    scoped.get(
      '/wishlist/reservations',
      {
        schema: {
          headers: MemberHeadersSchema,
          response: { 200: GiftReservationListDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        const reservations = await listGiftReservations(opts.deps, actor)
        return { reservations: reservations.map((row) => toGiftReservationDto(row.reservation)) }
      },
    )

    // One wish's reservation (issue #19): an unreserved wish and the
    // author's own wish answer the same 404, so the author probing the
    // read learns nothing either way.
    scoped.get(
      '/wishlist/wishes/:wishId/reservation',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 200: GiftReservationDtoSchema },
        },
      },
      async (request) => {
        const actor: WishlistActor = requireMemberActor(request)
        return toGiftReservationDto(
          await getWishReservation(opts.deps, actor, request.params.wishId),
        )
      },
    )

    // The claim (issue #19): visible to every member except the wish's
    // author from the moment it lands.
    scoped.post(
      '/wishlist/wishes/:wishId/reservation',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 201: GiftReservationDtoSchema },
        },
      },
      async (request, reply) => {
        const actor: WishlistActor = requireMemberActor(request)
        const reservation = await reserveWish(opts.deps, actor, request.params.wishId)
        return reply.code(201).send(toGiftReservationDto(reservation))
      },
    )

    // Only the reserving member cancels (issue #19); the wish's author's
    // cancel answers what an unreserved wish answers, so probing reveals
    // nothing.
    scoped.delete(
      '/wishlist/wishes/:wishId/reservation',
      {
        schema: {
          headers: MemberHeadersSchema,
          params: WishIdParamsSchema,
          response: { 204: Type.Null() },
        },
      },
      async (request, reply) => {
        const actor: WishlistActor = requireMemberActor(request)
        await cancelReservation(opts.deps, actor, request.params.wishId)
        return reply.code(204).send(null)
      },
    )
  })
}
