import { GoogleGenAI } from "@google/genai";
import type { ScheduleBlock } from '../types';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
    throw new Error("API_KEY environment variable not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const model = 'gemini-2.5-flash';

export const generatePlannerSchedule = async (userPrompt: string): Promise<string> => {
    const prompt = `You are a highly efficient personal assistant specializing in parent organization. Your task is to generate a comprehensive, hour-by-hour daily planner for a typical weekday based on the user's description.

First, analyze the user's request below to understand their situation. Extract details like the number of children, their work schedule, and their main priority for the day.

User's Request:
"${userPrompt}"

Now, using the information from the user's request, generate the planner with the following requirements:

1.  **Timeframe:** Cover a full weekday, from 6:00 AM to 10:00 PM, broken down into distinct hourly blocks.
2.  **Comprehensive Coverage:** Include all typical daily responsibilities: morning routine, school drop-off/pick-up (assume standard school hours, e.g., 8:30 AM - 3:30 PM), meal preparation, the user's specified work schedule, household chores (daily tidying, laundry, dishes), kids' activities (homework, one after-school activity), personal self-care (exercise, quiet time), and evening routine. Crucially, make sure to incorporate the user's stated priority.
3.  **Flexibility & Downtime:**
    *   Incorporate at least two "Flex Time" or "Personal Time" blocks (30-60 minutes each).
    *   Include brief (10-15 minute) "buffer" times between major transitions.
    *   Schedule dedicated downtime for the parent in the evening.
4.  **Tone:** Maintain a direct, efficient, and instructional tone.
5.  **Format:** Present the schedule in Markdown. Each time block MUST start with the time range in bold (e.g., "**7:00 AM - 8:00 AM: Morning Preparations**"). Following the time block, use bullet points for specific activities (e.g., "* Prepare breakfast."). Do not add any introductory or concluding text outside of the schedule itself. Start directly with the first time block and end with the last one.`;

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
        });
        return response.text;
    } catch (error) {
        console.error("Error generating planner schedule:", error);
        throw new Error("Failed to generate schedule from AI. Please check your API key and try again.");
    }
};

export const parsePlannerContent = (content: string): ScheduleBlock[] => {
    if (!content) return [];

    const blocks = content.split('**').filter(block => block.trim() !== '' && block.includes(':'));
    return blocks.map((block, index) => {
      const lines = block.trim().split('\n');
      const timeAndTitle = lines[0];
      const taskLines = lines.slice(1);

      let time = '';
      let title = '';
      
      // Match the time range ending with AM/PM, followed by a colon, and then the title.
      // This is more robust than splitting by ":" which fails if time contains colons.
      const match = timeAndTitle.match(/(.*(?:AM|PM))\s*:\s*(.*)/);

      if (match && match[1] && match[2]) {
          time = match[1].trim();
          title = match[2].trim();
      } else {
          // Fallback to the original logic if the regex fails for some reason
          const parts = timeAndTitle.split(':');
          time = parts.shift()?.trim() || '';
          title = parts.join(':').trim();
      }

      const tasks = taskLines
        .map(line => line.replace(/^[*\-]\s*/, '').trim())
        .filter(taskText => taskText !== '')
        .map(taskText => ({ text: taskText, notes: '' }));

      return { id: index, time, title, tasks };
    });
};
