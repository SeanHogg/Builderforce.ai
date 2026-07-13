import { NextRequest, NextResponse } from 'next/server';
import { getJobs, createJob, updateJob, deleteJob } from '@/lib/jobs';
import { Job, CreateJobInput } from '@/types/jobs';

// GET /api/jobs - List all jobs
export async function GET(request: NextRequest) {
  try {
    const jobs = await getJobs();
    return NextResponse.json(jobs);
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

// POST /api/jobs - Create a new job
export async function POST(request: NextRequest) {
  try {
    // TODO: Implement authentication middleware
    // const session = await authenticateSession(request);
    // if (!session || !session.isEmployer) {
    //   return NextResponse.json(
    //     { error: 'Unauthorized' },
    //     { status: 401 }
    //   );
    // }

    const body: CreateJobInput = await request.json();

    // Validate required fields
    if (!body.title || !body.department || !body.location || !body.employmentType) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    const job = await createJob(body);
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json(
      { error: 'Failed to create job' },
      { status: 500 }
    );
  }
}