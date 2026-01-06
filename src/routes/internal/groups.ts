import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { prisma as db } from '../../db.js';
import { requireAuth } from '../../utils/auth.js';
import { findOrCreateUser } from '../../utils/user-helpers.js';
import { zodToJsonSchemaFastify } from '../../utils/zod-to-json-schema.js';

const groupResponse = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  apiBaseUrl: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * Internal routes for group management
 * These are only accessible to authenticated users via Auth0 (your Next.js frontend)
 * NOT exposed in the public npm package
 */
export async function registerInternalGroupRoutes(app: FastifyInstance): Promise<void> {
  // Create a new group
  app.post(
    '/groups',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Create a new location group',
        description: 'Internal endpoint for creating groups. Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(
          z.object({
            name: z.string().min(3),
            description: z.string().optional(),
            apiBaseUrl: z.string().url().optional(),
          })
        ),
        response: {
          201: zodToJsonSchemaFastify(groupResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const body = request.body as { name: string; description?: string; apiBaseUrl?: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      const record = await db.groups.create({
        data: {
          name: body.name,
          description: body.description,
          api_base_url: body.apiBaseUrl,
          owner_id: user.id, // Use the user ID (which is the Auth0 sub)
        },
      });

      reply.code(201).send({
        id: record.id,
        name: record.name,
        description: record.description ?? null,
        apiBaseUrl: record.api_base_url ?? null,
        createdAt: record.created_at.toISOString(),
        updatedAt: record.updated_at.toISOString(),
      });
    }
  );

  // List groups owned by user
  app.get(
    '/groups',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] List groups you own',
        description: 'Internal endpoint for listing groups. Requires Auth0 authentication.',
        response: {
          200: zodToJsonSchemaFastify(z.object({ items: z.array(groupResponse) })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      const rows = await db.groups.findMany({
        where: { owner_id: user.id }, // Use the user ID (which is the Auth0 sub)
      });

      reply.send({
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description ?? null,
          apiBaseUrl: row.api_base_url ?? null,
          createdAt: row.created_at.toISOString(),
          updatedAt: row.updated_at.toISOString(),
        })),
      });
    }
  );

  // Get single group
  app.get(
    '/groups/:groupId',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Get a group by ID',
        description: 'Internal endpoint for getting group details. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(groupResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const ownerId = auth.sub ?? 'anonymous';

      // Find user
      let user = await db.users.findFirst({
        where: {
          OR: [{ email: auth.email as string }, { id: ownerId }],
        },
      });

      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user?.id ?? ownerId,
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      reply.send({
        id: group.id,
        name: group.name,
        description: group.description ?? null,
        apiBaseUrl: group.api_base_url ?? null,
        createdAt: group.created_at.toISOString(),
        updatedAt: group.updated_at.toISOString(),
      });
    }
  );

  // Update group
  app.patch(
    '/groups/:groupId',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Update a group',
        description: 'Internal endpoint for updating groups. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        body: zodToJsonSchemaFastify(
          z.object({
            name: z.string().min(3).optional(),
            description: z.string().optional(),
            apiBaseUrl: z.string().url().optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(groupResponse),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const body = request.body as { name?: string; description?: string; apiBaseUrl?: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user.id, // Use the user ID (which is the Auth0 sub)
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      const updated = await db.groups.update({
        where: { id: groupId },
        data: {
          ...(body.name && { name: body.name }),
          ...(body.description !== undefined && { description: body.description }),
          ...(body.apiBaseUrl !== undefined && { api_base_url: body.apiBaseUrl }),
        },
      });

      reply.send({
        id: updated.id,
        name: updated.name,
        description: updated.description ?? null,
        apiBaseUrl: updated.api_base_url ?? null,
        createdAt: updated.created_at.toISOString(),
        updatedAt: updated.updated_at.toISOString(),
      });
    }
  );

  // Delete group
  app.delete(
    '/groups/:groupId',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Delete a group',
        description: 'Internal endpoint for deleting groups. Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(z.object({ success: z.boolean() })),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      // Verify Auth0 access token and get user's sub
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };

      // auth.sub is guaranteed to exist from requireAuth
      const userId = auth.sub;

      // Find or create user using the sub from token
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: user.id, // Use the user ID (which is the Auth0 sub)
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      await db.groups.delete({
        where: { id: groupId },
      });

      reply.send({ success: true });
    }
  );

  // Join request endpoint (user → owner)
  app.post(
    '/groups/:groupId/join',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Submit a join request for a group',
        description:
          'Submit a JOIN REQUEST to join a group. This creates a request from the user to the group owner, which needs to be approved. This is different from invitations (owner → user). Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        body: zodToJsonSchemaFastify(
          z.object({
            email: z.string().email(),
            reason: z.string().max(500).optional(),
          })
        ),
        response: {
          202: zodToJsonSchemaFastify(
            z.object({ status: z.literal('pending'), memberId: z.string() })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { groupId } = request.params as { groupId: string };
      const body = request.body as { email: string; reason?: string };

      // Verify group exists
      const group = await db.groups.findUnique({ where: { id: groupId } });
      if (!group) {
        reply.code(404);
        throw new Error('Group not found');
      }

      // Find or create user
      let user = await db.users.findUnique({ where: { email: body.email } });
      if (!user) {
        user = await db.users.create({
          data: { email: body.email },
        });
      }

      // Create or update membership
      const member = await db.group_members.upsert({
        where: {
          group_id_user_id: {
            group_id: groupId,
            user_id: user.id,
          },
        },
        create: {
          group_id: groupId,
          user_id: user.id,
          status: 'pending',
        },
        update: {
          status: 'pending',
        },
      });

      reply.code(202).send({ status: 'pending', memberId: member.id });
    }
  );

  // Get user's active group memberships
  app.get(
    '/groups/memberships',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: "[Internal] Get user's active group memberships",
        description:
          'Get all groups the authenticated user is an active member of. Requires Auth0 authentication.',
        response: {
          200: zodToJsonSchemaFastify(
            z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  name: z.string(),
                  description: z.string().nullable(),
                })
              ),
            })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Get all active memberships for the user
      const memberships = await db.group_members.findMany({
        where: {
          user_id: user.id,
          status: 'active',
        },
        include: {
          groups: true,
        },
      });

      reply.send({
        items: memberships.map((membership) => ({
          id: membership.groups.id,
          name: membership.groups.name,
          description: membership.groups.description ?? null,
        })),
      });
    }
  );

  // Get join requests submitted by the user (user → owner)
  app.get(
    '/groups/membership-requests',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Get join requests submitted by the user',
        description:
          'Get all JOIN REQUESTS that the authenticated user has submitted to groups. These are requests from the user to join a group, which need to be approved by the group owner. This is different from invitations (owner → user). Requires Auth0 authentication.',
        querystring: zodToJsonSchemaFastify(
          z.object({
            status: z.enum(['pending', 'active', 'rejected']).optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(
            z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  groupId: z.string(),
                  groupName: z.string(),
                  groupDescription: z.string().nullable(),
                  status: z.string(),
                  createdAt: z.string(),
                  type: z.literal('join_request'), // User → Owner: request to join
                })
              ),
            })
          ),
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

      // Build where clause
      const where: { user_id: string; status?: string } = {
        user_id: user.id,
      };

      if (query.status) {
        where.status = query.status;
      }

      // Get all membership requests for the user
      const membershipRequests = await db.group_members.findMany({
        where,
        include: {
          groups: true,
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      reply.send({
        items: membershipRequests.map((request) => ({
          id: request.id,
          groupId: request.group_id,
          groupName: request.groups.name,
          groupDescription: request.groups.description ?? null,
          status: request.status,
          createdAt: request.created_at.toISOString(),
          type: 'join_request' as const, // User → Owner: request to join
        })),
      });
    }
  );

  // Get pending invitations for the user (owner → user)
  app.get(
    '/groups/pending-invitations',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Get pending invitations for the user',
        description:
          'Get all pending group INVITATIONS for the authenticated user. These are invitations sent from group owners to the user, which the user can accept. This is different from join requests (user → owner). Requires Auth0 authentication.',
        response: {
          200: zodToJsonSchemaFastify(
            z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  groupId: z.string(),
                  groupName: z.string(),
                  groupDescription: z.string().nullable(),
                  invitedBy: z.string(),
                  expiresAt: z.string().nullable(),
                  createdAt: z.string(),
                  type: z.literal('invitation'), // Owner → User: invitation to join
                })
              ),
            })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const userId = auth.sub;

      // Find or create user
      const user = await findOrCreateUser(userId, auth.email, auth.name);

      // Get all pending invitations for the user
      // Filter out expired invitations
      const now = new Date();
      const invitations = await db.group_invitations.findMany({
        where: {
          user_id: user.id,
          status: 'pending',
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        },
        include: {
          groups: true,
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      reply.send({
        items: invitations.map((invitation) => ({
          id: invitation.id,
          groupId: invitation.group_id,
          groupName: invitation.groups.name,
          groupDescription: invitation.groups.description ?? null,
          invitedBy: invitation.invited_by,
          expiresAt: invitation.expires_at?.toISOString() ?? null,
          createdAt: invitation.created_at.toISOString(),
          type: 'invitation' as const, // Owner → User: invitation to join
        })),
      });
    }
  );

  // Invite user to group by email (owner invites user - creates invitation)
  app.post(
    '/groups/:groupId/invite-by-email',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Invite user to group by email',
        description:
          'Invite a user to a group by email address. This creates an INVITATION (owner → user) that the user can accept. This is different from a join request (user → owner). Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        body: zodToJsonSchemaFastify(
          z.object({
            email: z.string().email(),
            expiresAt: z.coerce.date().optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(
            z.object({
              success: z.boolean(),
              invitationId: z.string(),
              status: z.literal('pending'),
            })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };
      const body = request.body as { email: string; expiresAt?: Date };

      const userId = auth.sub;

      // Find or create authenticated user
      const authenticatedUser = await findOrCreateUser(userId, auth.email, auth.name);

      // Verify group exists and user is owner
      const group = await db.groups.findFirst({
        where: {
          id: groupId,
          owner_id: authenticatedUser.id,
        },
      });

      if (!group) {
        reply.code(404);
        throw new Error('Group not found or you are not the owner');
      }

      // Find or create target user by email
      let targetUser = await db.users.findUnique({
        where: { email: body.email },
      });

      if (!targetUser) {
        // Create user with email only (no Auth0 ID since they haven't logged in yet)
        targetUser = await db.users.create({
          data: { email: body.email },
        });
      }

      // Check if invitation already exists
      const existing = await db.group_invitations.findUnique({
        where: {
          group_id_user_id: {
            group_id: groupId,
            user_id: targetUser.id,
          },
        },
      });

      if (existing && existing.status === 'pending') {
        reply.code(409);
        throw new Error('Invitation already exists and is pending');
      }

      // Create invitation (owner → user)
      const invitation = await db.group_invitations.create({
        data: {
          id: nanoid(),
          group_id: groupId,
          user_id: targetUser.id,
          invited_by: authenticatedUser.id,
          status: 'pending',
          expires_at: body.expiresAt,
          updated_at: new Date(),
        },
      });

      reply.send({
        success: true,
        invitationId: invitation.id,
        status: 'pending' as const,
      });
    }
  );

  // Get pending join requests for a group (user → owner)
  app.get(
    '/groups/:groupId/members/pending',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Get pending join requests for a group',
        description:
          'Get all pending JOIN REQUESTS for a specific group. These are requests from users wanting to join the group, which need to be approved by the group owner. This is different from invitations (owner → user). Requires Auth0 authentication.',
        params: zodToJsonSchemaFastify(z.object({ groupId: z.string().min(4) })),
        response: {
          200: zodToJsonSchemaFastify(
            z.object({
              items: z.array(
                z.object({
                  id: z.string(),
                  userEmail: z.string(),
                  userName: z.string().nullable(),
                  createdAt: z.string(),
                  type: z.literal('join_request'), // User → Owner: request to join
                })
              ),
            })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const { groupId } = request.params as { groupId: string };

      const userId = auth.sub;

      // Find or create authenticated user
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

      // Get pending memberships
      const pendingMembers = await db.group_members.findMany({
        where: {
          group_id: groupId,
          status: 'pending',
        },
        include: {
          users: true,
        },
        orderBy: {
          created_at: 'desc',
        },
      });

      reply.send({
        items: pendingMembers.map((member) => ({
          id: member.id,
          userEmail: member.users.email,
          userName: member.users.name ?? null,
          createdAt: member.created_at.toISOString(),
          type: 'join_request' as const, // User → Owner: request to join
        })),
      });
    }
  );

  // Batch invite users to groups (owner invites users - creates invitations)
  app.post(
    '/groups/batch-invite',
    {
      schema: {
        tags: ['Internal - Groups'],
        summary: '[Internal] Batch invite users to groups',
        description:
          'Invite multiple users to multiple groups in one request. This creates INVITATIONS (owner → users) that users can accept. This is different from join requests (users → owner). Requires Auth0 authentication.',
        body: zodToJsonSchemaFastify(
          z.object({
            userEmails: z.array(z.string().email()),
            groupIds: z.array(z.string().min(4)),
            expiresAt: z.coerce.date().optional(),
          })
        ),
        response: {
          200: zodToJsonSchemaFastify(
            z.object({
              success: z.boolean(),
              invited: z.number(),
              failed: z.number(),
              errors: z.array(
                z.object({
                  email: z.string(),
                  error: z.string(),
                })
              ),
            })
          ),
        },
        security: [{ bearerAuth: [] }],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await requireAuth(request, reply);
      const body = request.body as {
        userEmails: string[];
        groupIds: string[];
        expiresAt?: Date;
      };

      const userId = auth.sub;

      // Find or create authenticated user
      const authenticatedUser = await findOrCreateUser(userId, auth.email, auth.name);

      // Verify all groups exist and user is owner
      const groups = await db.groups.findMany({
        where: {
          id: { in: body.groupIds },
          owner_id: authenticatedUser.id,
        },
      });

      if (groups.length !== body.groupIds.length) {
        reply.code(403);
        throw new Error('One or more groups not found or you are not the owner');
      }

      const errors: Array<{ email: string; error: string }> = [];
      let invited = 0;

      // Process each email and group combination
      for (const email of body.userEmails) {
        try {
          // Find or create target user by email
          let targetUser = await db.users.findUnique({
            where: { email },
          });

          if (!targetUser) {
            targetUser = await db.users.create({
              data: { email },
            });
          }

          // Create invitations for all groups (owner → users)
          for (const groupId of body.groupIds) {
            // Check if invitation already exists
            const existing = await db.group_invitations.findUnique({
              where: {
                group_id_user_id: {
                  group_id: groupId,
                  user_id: targetUser.id,
                },
              },
            });

            // Only create if it doesn't exist or is not pending
            if (!existing || existing.status !== 'pending') {
              await db.group_invitations.create({
                data: {
                  id: nanoid(),
                  group_id: groupId,
                  user_id: targetUser.id,
                  invited_by: authenticatedUser.id,
                  status: 'pending',
                  expires_at: body.expiresAt,
                  updated_at: new Date(),
                },
              });
            }
          }

          invited++;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push({ email, error: errorMessage });
        }
      }

      reply.send({
        success: true,
        invited,
        failed: errors.length,
        errors,
      });
    }
  );
}
