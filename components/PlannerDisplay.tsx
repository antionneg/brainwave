import React, { useState, useEffect } from 'react';
import type { ScheduleBlock, Task } from '../types';
import { BriefcaseIcon, CarIcon, CoffeeIcon, HomeIcon, MoonIcon, HeartIcon, BookOpenIcon, CalendarIcon, EditIcon, TrashIcon, NotesIcon, SparklesIcon } from './icons';

interface PlannerDisplayProps {
  blocks: ScheduleBlock[];
  reminderTime: number; // in minutes
  completedTasks: Record<string, boolean>;
  onUpdateTaskText: (blockId: number, taskIndex: number, newText: string) => void;
  onUpdateTaskNotes: (blockId: number, taskIndex: number, newNotes: string) => void;
  onDeleteTask: (blockId: number, taskIndex: number) => void;
  onReorderTasks: (
    source: { blockId: number; taskIndex: number },
    destination: { blockId: number; taskIndex: number }
  ) => void;
  onNotify: () => void;
  onToggleTask: (blockId: number, taskIndex: number) => void;
  onClearCompletedTasks: () => void;
}

const getIconForTitle = (title: string): React.ReactNode => {
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes('work') || lowerTitle.includes('focus')) return <BriefcaseIcon />;
    if (lowerTitle.includes('school') || lowerTitle.includes('drop-off') || lowerTitle.includes('pick-up')) return <CarIcon />;
    if (lowerTitle.includes('morning') || lowerTitle.includes('breakfast') || lowerTitle.includes('kickstart')) return <CoffeeIcon />;
    if (lowerTitle.includes('evening') || lowerTitle.includes('dinner') || lowerTitle.includes('bedtime') || lowerTitle.includes('wind down')) return <MoonIcon />;
    if (lowerTitle.includes('personal') || lowerTitle.includes('flex time') || lowerTitle.includes('self-care') || lowerTitle.includes('exercise')) return <HeartIcon />;
    if (lowerTitle.includes('homework') || lowerTitle.includes('reading')) return <BookOpenIcon />;
    return <HomeIcon />;
};

// Helper to parse time like "7:00 AM" into today's date with that time.
const parseTime = (timeStr: string): Date | null => {
    if (!timeStr || typeof timeStr !== 'string') {
        return null;
    }
    const match = timeStr.trim().match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!match) return null;

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_, hours, minutes, period] = match;
    let h = parseInt(hours, 10);

    if (period.toUpperCase() === 'PM' && h < 12) {
        h += 12;
    }
    if (period.toUpperCase() === 'AM' && h === 12) { // Midnight case: 12 AM is 00 hours
        h = 0;
    }

    const date = new Date();
    date.setHours(h, parseInt(minutes, 10), 0, 0);
    return date;
};

// Helper to format a Date object into the UTC format required for .ics files
const formatToICSDate = (date: Date): string => {
    const pad = (num: number) => num.toString().padStart(2, '0');
    
    const year = date.getUTCFullYear();
    const month = pad(date.getUTCMonth() + 1);
    const day = pad(date.getUTCDate());
    const hours = pad(date.getUTCHours());
    const minutes = pad(date.getUTCMinutes());
    const seconds = pad(date.getUTCSeconds());
    
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
};

const PlannerDisplay: React.FC<PlannerDisplayProps> = ({ blocks, reminderTime, completedTasks, onUpdateTaskText, onUpdateTaskNotes, onDeleteTask, onReorderTasks, onNotify, onToggleTask, onClearCompletedTasks }) => {
  const [currentTime, setCurrentTime] = useState(new Date());
  const [notifiedBlockIds, setNotifiedBlockIds] = useState<Set<number>>(new Set());
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>('');
  const [taskToDelete, setTaskToDelete] = useState<{ blockId: number; taskIndex: number } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // State for notes modal
  const [editingNotes, setEditingNotes] = useState<{ blockId: number; taskIndex: number; text: string; notes: string } | null>(null);
  const [currentNotesText, setCurrentNotesText] = useState('');

  // Drag and Drop State
  const [draggedTask, setDraggedTask] = useState<{ blockId: number; taskIndex: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ blockId: number; taskIndex: number } | null>(null);

  // State for clear completed confirmation
  const [isClearConfirmVisible, setIsClearConfirmVisible] = useState(false);

  // Reset notified blocks when a new schedule is generated
  useEffect(() => {
    setNotifiedBlockIds(new Set());
  }, [blocks]);


  useEffect(() => {
    // Update current time every second for a smooth progress bar animation
    const timerId = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000); 

    return () => clearInterval(timerId);
  }, []);

  // Effect for handling notifications
  useEffect(() => {
    if (reminderTime === 0 || Notification.permission !== 'granted' || blocks.length === 0) {
        return;
    }

    const intervalId = setInterval(() => {
        const now = new Date();
        blocks.forEach(block => {
            const timePart = block.time.split('-')[0];
            const startTime = parseTime(timePart);

            if (startTime && !notifiedBlockIds.has(block.id)) {
                const notificationTime = new Date(startTime.getTime() - reminderTime * 60 * 1000);
                
                // If it's time to notify and we haven't passed the start time yet
                if (now >= notificationTime && now < startTime) {
                    onNotify();
                    new Notification(`Upcoming: ${block.title}`, {
                        body: `Starts in ${reminderTime} min. First task: ${block.tasks[0]?.text || 'Get ready!'}`,
                    });
                    setNotifiedBlockIds(prev => new Set(prev).add(block.id));
                }
            }
        });
    }, 30000); // Check every 30 seconds

    return () => clearInterval(intervalId);
  }, [blocks, reminderTime, notifiedBlockIds, onNotify]);
  
  const handleStartEditing = (blockId: number, taskIndex: number, currentText: string) => {
    setEditingTaskId(`${blockId}-${taskIndex}`);
    setEditingText(currentText);
  };

  useEffect(() => {
    if (editingTaskId && inputRef.current) {
        inputRef.current.focus();
    }
  }, [editingTaskId]);

  const handleSaveEditing = (blockId: number, taskIndex: number) => {
    if (editingText.trim() !== '') {
      onUpdateTaskText(blockId, taskIndex, editingText);
    }
    setEditingTaskId(null);
    setEditingText('');
  };

  const handleEditingKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, blockId: number, taskIndex: number) => {
    if (e.key === 'Enter') {
      handleSaveEditing(blockId, taskIndex);
    } else if (e.key === 'Escape') {
      setEditingTaskId(null);
      setEditingText('');
    }
  };

  const handleDeleteClick = (blockId: number, taskIndex: number) => {
    setTaskToDelete({ blockId, taskIndex });
  };

  const confirmDelete = () => {
    if (taskToDelete) {
      onDeleteTask(taskToDelete.blockId, taskToDelete.taskIndex);
      setTaskToDelete(null);
    }
  };

  const cancelDelete = () => {
    setTaskToDelete(null);
  };

  const handleOpenNotes = (blockId: number, taskIndex: number, task: Task) => {
    setEditingNotes({ blockId, taskIndex, text: task.text, notes: task.notes });
    setCurrentNotesText(task.notes);
  };

  const handleSaveNotes = () => {
    if (editingNotes) {
      onUpdateTaskNotes(editingNotes.blockId, editingNotes.taskIndex, currentNotesText);
      setEditingNotes(null);
      setCurrentNotesText('');
    }
  };

  const handleCancelNotes = () => {
    setEditingNotes(null);
    setCurrentNotesText('');
  };

  const handleAddToCalendar = (block: ScheduleBlock) => {
    const timeParts = block.time.split('-').map(parseTime);
    if (timeParts.length < 2 || !timeParts[0] || !timeParts[1]) {
      console.error("Could not parse time for calendar event:", block.time);
      alert("Sorry, the time format for this block is not supported for calendar export.");
      return;
    }
    const [startDate, endDate] = timeParts;

    const icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BrainWave//AI Planner//EN',
      'BEGIN:VEVENT',
      `UID:${block.id}-${Date.now()}@brainwave.app`,
      `DTSTAMP:${formatToICSDate(new Date())}`,
      `DTSTART:${formatToICSDate(startDate)}`,
      `DTEND:${formatToICSDate(endDate)}`,
      `SUMMARY:${block.title}`,
      `DESCRIPTION:${block.tasks.map(t => t.text).join('\\n')}`, // \n is the newline character for .ics descriptions
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n'); // Use CRLF for line endings

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const filename = `${block.title.replace(/[^a-zA-Z0-9]/g, '_')}.ics`;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Drag and Drop Handlers
  const handleDragStart = (e: React.DragEvent, blockId: number, taskIndex: number) => {
    setDraggedTask({ blockId, taskIndex });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnter = (e: React.DragEvent, blockId: number, taskIndex: number) => {
    e.preventDefault();
    if (draggedTask && (draggedTask.blockId !== blockId || draggedTask.taskIndex !== taskIndex)) {
      setDropTarget({ blockId, taskIndex });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = () => {
      setDropTarget(null);
  };

  const handleDrop = (e: React.DragEvent, destBlockId: number, destTaskIndex: number) => {
    e.preventDefault();
    if (draggedTask) {
      onReorderTasks(draggedTask, { blockId: destBlockId, taskIndex: destTaskIndex });
    }
    setDraggedTask(null);
    setDropTarget(null);
  };

  const handleDragEnd = () => {
    setDraggedTask(null);
    setDropTarget(null);
  };

  const hasCompletedTasks = Object.values(completedTasks).some(isCompleted => isCompleted);
  
  return (
    <>
      {hasCompletedTasks && (
        <div className="flex justify-end mb-4 animate-fade-in-up">
          <button 
            onClick={() => setIsClearConfirmVisible(true)}
            className="flex items-center gap-2 px-4 py-2 bg-slate-700 text-slate-300 text-sm rounded-md hover:bg-slate-600 hover:text-white transition-colors"
            aria-label="Clear all completed tasks"
          >
            <SparklesIcon />
            Clear Completed Tasks
          </button>
        </div>
      )}
      <div className="space-y-6">
        {blocks.map((block, index) => {
          const timeParts = block.time.split('-').map(s => s.trim());
          const startTimeStr = timeParts[0];
          const endTimeStr = timeParts[1];

          const startTime = parseTime(startTimeStr);
          const endTime = parseTime(endTimeStr);

          let progress = 0;
          if (startTime && endTime && startTime < endTime) {
            const blockDuration = endTime.getTime() - startTime.getTime();
            const elapsed = currentTime.getTime() - startTime.getTime();
            progress = Math.min(100, Math.max(0, (elapsed / blockDuration) * 100));
          }
          const isCurrent = startTime && endTime && currentTime >= startTime && currentTime <= endTime;

          return (
            <div 
              key={block.id} 
              className={`bg-slate-800/50 backdrop-blur-sm border border-slate-700 rounded-xl shadow-lg transition-all duration-300 animate-fade-in-up ${isCurrent ? 'ring-2 ring-cyan-500 block-glow' : ''}`}
              style={{ animationDelay: `${index * 100}ms` }}
              >
              <div className="p-4 border-b border-slate-700 flex justify-between items-center">
                <div className="flex items-center gap-3">
                  <span className={`text-cyan-400 ${isCurrent ? 'animate-pulse' : ''}`}>{getIconForTitle(block.title)}</span>
                  <div>
                    <h3 className="font-bold text-slate-100 text-lg sm:text-xl">{block.title}</h3>
                    <p className="text-sm text-slate-400">{block.time}</p>
                  </div>
                </div>
                <button onClick={() => handleAddToCalendar(block)} className="p-1.5 rounded-full hover:bg-slate-700 transition-colors text-slate-400 hover:text-white" aria-label="Add to calendar">
                  <CalendarIcon />
                </button>
              </div>
              
              <div className="w-full bg-slate-700 h-1.5 rounded-bl-xl rounded-br-xl overflow-hidden">
                  <div className="bg-gradient-to-r from-cyan-500 to-blue-500 h-1.5 progress-bar-gradient" style={{ width: `${progress}%`, transition: 'width 1s linear' }}></div>
              </div>

              <ul 
                className="p-4 space-y-3"
                onDragOver={handleDragOver}
                onDragEnter={(e) => {
                  e.preventDefault();
                  if (draggedTask && block.tasks.length === 0) {
                    setDropTarget({ blockId: block.id, taskIndex: 0 });
                  }
                }}
                onDrop={(e) => handleDrop(e, block.id, block.tasks.length)}
                onDragLeave={handleDragLeave}
              >
                {block.tasks.map((task, taskIndex) => {
                  const taskId = `${block.id}-${taskIndex}`;
                  const isCompleted = completedTasks[taskId];
                  const isEditing = editingTaskId === taskId;
                  const isBeingDragged = draggedTask?.blockId === block.id && draggedTask?.taskIndex === taskIndex;
                  const isDropTarget = dropTarget?.blockId === block.id && dropTarget?.taskIndex === taskIndex;

                  return (
                    <li 
                      key={taskIndex} 
                      draggable={!isEditing}
                      onDragStart={(e) => !isEditing && handleDragStart(e, block.id, taskIndex)}
                      onDragEnter={(e) => !isEditing && handleDragEnter(e, block.id, taskIndex)}
                      onDragOver={handleDragOver}
                      onDrop={(e) => !isEditing && handleDrop(e, block.id, taskIndex)}
                      onDragEnd={handleDragEnd}
                      className={`relative flex items-center gap-3 group transition-all duration-300 ${isBeingDragged ? 'opacity-30' : ''} ${!isEditing ? 'cursor-move' : 'cursor-default'}`}
                    >
                      {isDropTarget && (
                        <div className="absolute top-[-4px] left-0 right-0 h-1 bg-cyan-400 rounded-full" aria-hidden="true" />
                      )}
                      <input
                        type="checkbox"
                        id={taskId}
                        checked={!!isCompleted}
                        onChange={() => onToggleTask(block.id, taskIndex)}
                        className="h-5 w-5 rounded-md border-slate-500 text-cyan-500 bg-slate-700 focus:ring-cyan-500/50 focus:ring-offset-slate-800 transition-all"
                      />
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          onBlur={() => handleSaveEditing(block.id, taskIndex)}
                          onKeyDown={(e) => handleEditingKeyDown(e, block.id, taskIndex)}
                          className="flex-grow bg-slate-700 border border-slate-600 rounded-md px-2 py-1 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                        />
                      ) : (
                        <label 
                          htmlFor={taskId} 
                          onDoubleClick={() => handleStartEditing(block.id, taskIndex, task.text)}
                          title="Double-click to edit task"
                          className={`flex-grow text-slate-300 transition-all duration-300 cursor-pointer text-sm sm:text-base ${isCompleted ? 'line-through text-slate-500 opacity-70' : ''}`}>
                          {task.text}
                        </label>
                      )}
                      <div className="flex items-center gap-2 transition-opacity">
                          <button onClick={() => handleOpenNotes(block.id, taskIndex, task)} className={`transition-colors ${task.notes ? 'text-cyan-400 hover:text-cyan-300' : 'text-slate-500 hover:text-cyan-400'}`} aria-label="Add or edit notes">
                              <NotesIcon />
                          </button>
                          <button onClick={() => handleStartEditing(block.id, taskIndex, task.text)} className="text-slate-500 hover:text-cyan-400 transition-colors" aria-label="Edit task">
                              <EditIcon />
                          </button>
                          <button onClick={() => handleDeleteClick(block.id, taskIndex)} className="text-slate-500 hover:text-red-400 transition-colors" aria-label="Delete task">
                              <TrashIcon />
                          </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {isClearConfirmVisible && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-white">Confirm Clear</h3>
            <p className="text-slate-400 mt-2 mb-4">Are you sure you want to remove all completed tasks from the list?</p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setIsClearConfirmVisible(false)} className="px-4 py-2 bg-slate-600 text-white rounded-md hover:bg-slate-500 transition-colors">Cancel</button>
              <button 
                onClick={() => {
                  onClearCompletedTasks();
                  setIsClearConfirmVisible(false);
                }} 
                className="px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-500 transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {editingNotes && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-6 max-w-lg w-full">
            <h3 className="text-lg font-bold text-white mb-1">Notes for:</h3>
            <p className="text-cyan-300 mb-4 font-medium">{editingNotes.text}</p>
            <textarea
              value={currentNotesText}
              onChange={(e) => setCurrentNotesText(e.target.value)}
              rows={5}
              className="w-full bg-slate-700 border border-slate-600 rounded-md px-3 py-2 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500"
              placeholder="Add your details here..."
              autoFocus
            />
            <div className="flex justify-end gap-3 mt-4">
              <button onClick={handleCancelNotes} className="px-4 py-2 bg-slate-600 text-white rounded-md hover:bg-slate-500 transition-colors">Cancel</button>
              <button onClick={handleSaveNotes} className="px-4 py-2 bg-cyan-600 text-white rounded-md hover:bg-cyan-500 transition-colors">Save Notes</button>
            </div>
          </div>
        </div>
      )}

      {taskToDelete && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-lg shadow-xl p-6 max-w-sm w-full">
            <h3 className="text-lg font-bold text-white">Confirm Deletion</h3>
            <p className="text-slate-400 mt-2 mb-4">Are you sure you want to delete this task? This action cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <button onClick={cancelDelete} className="px-4 py-2 bg-slate-600 text-white rounded-md hover:bg-slate-500 transition-colors">Cancel</button>
              <button onClick={confirmDelete} className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-500 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default PlannerDisplay;