import React, { useState, useEffect, DragEvent } from 'react';
import styles from './TechShuffle.module.css';

interface Props {
  items: string[];
  initialOrder?: string[];
  onOrderChange: (newOrder: string[]) => void;
  disabled?: boolean;
}

export default function TechShuffle({ items, initialOrder, onOrderChange, disabled = false }: Props) {
  const [orderedItems, setOrderedItems] = useState<string[]>([]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (initialOrder && initialOrder.length > 0) {
      setOrderedItems(initialOrder);
    } else {
      setOrderedItems([...items]);
    }
  }, [items, initialOrder]);

  const moveItem = (index: number, direction: 'UP' | 'DOWN') => {
    if (disabled) return;
    const targetIndex = direction === 'UP' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= orderedItems.length) return;

    const updated = [...orderedItems];
    const [moved] = updated.splice(index, 1);
    updated.splice(targetIndex, 0, moved);

    setOrderedItems(updated);
    onOrderChange(updated);
  };

  const handleDragStart = (e: DragEvent<HTMLDivElement>, index: number) => {
    if (disabled) return;
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    if (disabled || draggedIndex === null || draggedIndex === index) return;
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>, targetIndex: number) => {
    e.preventDefault();
    if (disabled || draggedIndex === null || draggedIndex === targetIndex) return;

    const updated = [...orderedItems];
    const [moved] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, moved);

    setOrderedItems(updated);
    onOrderChange(updated);
    setDraggedIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  return (
    <div className={styles.container}>
      <div className={styles.instruction}>
        <span className={styles.badge}>Order Sequence</span>
        <span className={styles.hint}>
          Drag and drop cards or use the arrows to arrange into the correct sequence (1 = First, {orderedItems.length} = Last):
        </span>
      </div>

      <div className={styles.list}>
        {orderedItems.map((item, index) => (
          <div
            key={item}
            className={`${styles.itemCard} ${draggedIndex === index ? styles.itemCardDragging : ''}`}
            draggable={!disabled}
            onDragStart={(e) => handleDragStart(e, index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDrop={(e) => handleDrop(e, index)}
            onDragEnd={handleDragEnd}
          >
            <div className={styles.dragHandle} title="Drag to reorder">
              ⋮⋮
            </div>
            <div className={styles.itemPosition}>{index + 1}</div>
            <div className={styles.itemText}>{item}</div>
            {!disabled && (
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.moveBtn}
                  disabled={index === 0 || disabled}
                  onClick={() => moveItem(index, 'UP')}
                  title="Move Up"
                  aria-label="Move Up"
                >
                  ▲
                </button>
                <button
                  type="button"
                  className={styles.moveBtn}
                  disabled={index === orderedItems.length - 1 || disabled}
                  onClick={() => moveItem(index, 'DOWN')}
                  title="Move Down"
                  aria-label="Move Down"
                >
                  ▼
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
