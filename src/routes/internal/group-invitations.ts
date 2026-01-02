import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { requireAuth } from '../../utils/auth.js';
import { findOrCreateUser } from '../../utils/user-helpers.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

const invitationResponse = z.object({
  id: z.string(),
  groupId: z.string(),
  userId: z.string(),
  invitedBy: z.string(),
  status: z.string(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  acceptedAt: z.string().nullable(),
  rejectedAt: z.string().nullable(),
});

/**
 * Internal routes for group invitations
 * These require Auth0 authentication
 */
export async function registerGroupInvitationRoutes(app: FastifyInstance): Promise<void> {
  // Create a group invitation
  app.post(
    '/groups/:groupId/invitations',
    {
      schema: {
        tags: ['Internal - Group Invitations'],
        summary: '[Internal] Create a group invitation',
        description: 'Invite a user to join a group. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        body: zodToJsonSchemaFastify(
          z.object({
            userId: z.string().min(1),
            expiresAt: z.coerce.date().optional(),
          })
        ),
        response: {
          201: zodToJsonSchemaFastify(invitationResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const body = request.body as { userId: string; expiresAt?: Date };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Verify group exists and user is owner
      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user.id,
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found or you are not the owner');
      }

      // Verify target user exists
      const targetUser = await db.users.findUnique({
        where: { id: body.userId },
      });

      if (!targetUser) {
        reply.code(404);
        throw new Error('Target user not found');
      }

      // Check if invitation already exists
      const existing = await db.group_invitations.findUnique({
        where: {
          group_id_user_id: {
            group_id: groupId,
            user_id: body.userId,
          },
        },
      });

      if (existing && existing.status === 'pending') {
        reply.code(409);
        throw new Error('Invitation already exists and is pending');
      }

      // Create invitation
      const invitation = await db.group_invitations.create({
        data: {
          id: nanoid(),
          group_id: groupId,
          user_id: body.userId,
          invited_by: user.id,
          status: 'pending',
          expires_at: body.expiresAt,
          updated_at: new Date(),
        },
      });

      reply.code(201).send({
        id: invitation.id,
        groupId: invitation.group_id,
        userId: invitation.user_id,
        invitedBy: invitation.invited_by,
        status: invitation.status,
        expiresAt: invitation.expires_at?.toISOString() ?? null,
        createdAt: invitation.created_at.toISOString(),
        updatedAt: invitation.updated_at.toISOString(),
        acceptedAt: invitation.accepted_at?.toISOString() ?? null,
        rejectedAt: invitation.rejected_at?.toISOString() ?? null,
      });
    }
  );

  // List invitations for a group
  app.get(
    '/groups/:groupId/invitations',
    {
      schema: {
        tags: ['Internal - Group Invitations'],
        summary: '[Internal] List group invitations',
        description: 'List all invitations for a group. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        querystring: zodToJsonSchemaFastify(
          z.object({
            status: z.enum(['pending', 'accepted', 'rejected']).optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(invitationResponse) })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const query = request.query as { status?: string };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Verify group exists and user is owner
      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user.id,
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found or you are not the owner');
      }

      const where: { group_id: string; status?: string } = {
        group_id: groupId,
      };

      if (query.status) {
        where.status = query.status;
      }

      const invitations = await db.group_invitations.findMany({
        where,
        orderBy: { created_at: 'desc' },
      });

      reply.send({
        items: invitations.map((inv) => ({
          id: inv.id,
          groupId: inv.group_id,
          userId: inv.user_id,
          invitedBy: inv.invited_by,
          status: inv.status,
          expiresAt: inv.expires_at?.toISOString() ?? null,
          createdAt: inv.created_at.toISOString(),
          updatedAt: inv.updated_at.toISOString(),
          acceptedAt: inv.accepted_at?.toISOString() ?? null,
          rejectedAt: inv.rejected_at?.toISOString() ?? null,
        })),
      });
    }
  );

  // List invitations for current user
  app.get(
    '/invitations',
    {
      schema: {
        tags: ['Internal - Group Invitations'],
        summary: '[Internal] List my invitations',
        description:
          'List all invitations for the authenticated user. Requires Auth0 authentication.',
        querystring: zodToJsonSchemaFastify(
          z.object({
            status: z.enum(['pending', 'accepted', 'rejected']).optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(invitationResponse) })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const query = request.query as { status?: string };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      const where: { user_id: string; status?: string } = {
        user_id: user.id,
      };

      if (query.status) {
        where.status = query.status;
      }

      const invitations = await db.group_invitations.findMany({
        where,
        orderBy: { created_at: 'desc' },
      });

      reply.send({
        items: invitations.map((inv) => ({
          id: inv.id,
          groupId: inv.group_id,
          userId: inv.user_id,
          invitedBy: inv.invited_by,
          status: inv.status,
          expiresAt: inv.expires_at?.toISOString() ?? null,
          createdAt: inv.created_at.toISOString(),
          updatedAt: inv.updated_at.toISOString(),
          acceptedAt: inv.accepted_at?.toISOString() ?? null,
          rejectedAt: inv.rejected_at?.toISOString() ?? null,
        })),
      });
    }
  );

  // Accept an invitation
  app.post(
    '/invitations/:invitationId/accept',
    {
      schema: {
        tags: ['Internal - Group Invitations'],
        summary: '[Internal] Accept a group invitation',
        description: 'Accept a group invitation. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ invitationId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(invitationResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { invitationId } = request.params as { invitationId: string };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Find invitation
      const invitation = await db.group_invitations.findUnique({
        where: { id: invitationId },
      });

      if (!invitation) {
        reply.code(404);
        throw new Error('Invitation not found');
      }

      // Verify invitation belongs to user
      if (invitation.user_id !== user.id) {
        reply.code(403);
        throw new Error('This invitation does not belong to you');
      }

      // Check if already accepted/rejected
      if (invitation.status !== 'pending') {
        reply.code(400);
        throw new Error(`Invitation has already been ${invitation.status}`);
      }

      // Check if expired
      if (invitation.expires_at && invitation.expires_at < new Date()) {
        reply.code(400);
        throw new Error('Invitation has expired');
      }

      // Update invitation
      const updated = await db.group_invitations.update({
        where: { id: invitationId },
        data: {
          status: 'accepted',
          accepted_at: new Date(),
          updated_at: new Date(),
        },
      });

      // Create group membership
      await db.group_members.upsert({
        where: {
          group_id_user_id: {
            group_id: invitation.group_id,
            user_id: user.id,
          },
        },
        create: {
          group_id: invitation.group_id,
          user_id: user.id,
          status: 'active',
        },
        update: {
          status: 'active',
        },
      });

      reply.send({
        id: updated.id,
        groupId: updated.group_id,
        userId: updated.user_id,
        invitedBy: updated.invited_by,
        status: updated.status,
        expiresAt: updated.expires_at?.toISOString() ?? null,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
        acceptedAt: updated.accepted_at?.toISOString() ?? null,
        rejectedAt: updated.rejected_at?.toISOString() ?? null,
      });
    }
  );

  // Reject an invitation
  app.post(
    '/invitations/:invitationId/reject',
    {
      schema: {
        tags: ['Internal - Group Invitations'],
        summary: '[Internal] Reject a group invitation',
        description: 'Reject a group invitation. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ invitationId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(invitationResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { invitationId } = request.params as { invitationId: string };

      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Find invitation
      const invitation = await db.group_invitations.findUnique({
        where: { id: invitationId },
      });

      if (!invitation) {
        reply.code(404);
        throw new Error('Invitation not found');
      }

      // Verify invitation belongs to user
      if (invitation.user_id !== user.id) {
        reply.code(403);
        throw new Error('This invitation does not belong to you');
      }

      // Check if already accepted/rejected
      if (invitation.status !== 'pending') {
        reply.code(400);
        throw new Error(`Invitation has already been ${invitation.status}`);
      }

      // Update invitation
      const updated = await db.group_invitations.update({
        where: { id: invitationId },
        data: {
          status: 'rejected',
          rejected_at: new Date(),
          updated_at: new Date(),
        },
      });

      reply.send({
        id: updated.id,
        groupId: updated.group_id,
        userId: updated.user_id,
        invitedBy: updated.invited_by,
        status: updated.status,
        expiresAt: updated.expires_at?.toISOString() ?? null,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
        acceptedAt: updated.accepted_at?.toISOString() ?? null,
        rejectedAt: updated.rejected_at?.toISOString() ?? null,
      });
    }
  );
}
