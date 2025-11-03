
export interface Task {
  text: string;
  notes: string;
}

export interface ScheduleBlock {
  id: number;
  time: string;
  title: string;
  tasks: Task[];
}