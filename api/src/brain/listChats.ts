import { NextRequest, NextResponse } from 'next/server';
import { withAuth } from '@/middleware/auth';
import { prismaClient } from '@/lib/prisma';

/**
 * GET /api/brain/chats/list
 *
 * Retrieves a list of chats owned by the current user for a given project.
 *
 * @param projectId - ID of the project to query chats for
 * @returns JSON with { chats: string[] }
 */
export const GET = withAuth(async (req: NextRequest, context: { params: { projectId: string } }) => {
  const { projectId } = context.params;

  // Validate projectId is provided
  if (!projectId || projectId === 'undefined' || projectId === 'null') {
    return NextResponse.json(
      { error: 'projectId is required' },
      { status: 400 }
    );
  }

  try {
    // Get current user from request
    const userId = (req as any).userId;

    if (!userId) {
      return NextResponse.json(
        { error: 'Unauthorized - no user context' },
        { status: 401 }
      );
    }

    // Fetch chats owned by this user for the specified project
    // Order by createdAt ASC (older chats first)
    const chats = await prismaClient.team_chat.findMany({
      where: {
        projectId: parseInt(projectId, 10),
        messages: {
          some: {
            assignedUserId: userId
          },
        },
        OR: [
          {
            ownerId: userId,
          },
          {
            messages: {
              some: {
                assignedUserId: userId,
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // Extract chat IDs into a simple array
    const chatIds = chats.map((chat) => chat.id);

    return NextResponse.json({
      chats: chatIds,
    });
  } catch (error) {
    console.error('Error listing brain chats:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});