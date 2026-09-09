import React, { useState, useEffect } from 'react';
import styles from './TechShuffle.module.css';

interface Props {
  items: string[];
  initialOrder?: string[];
  onOrderChange: (newOrder: string[]) => void;
  disabled?: boolean;
}

export default function TechShuffle({ items, initialOrder, onOrderChange, disabled = false }: Props) {
  const [orderedItems, setOrderedItems] = useState<string[]>([]);

  useEffect(() => {
    if (initialOrder && initialOrder.length > 0) {
      setOrderedItems(initialOrder);
    } else {
      // Provide an initially scrambled or default order
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

  return (
    <div className={styles.container}>
      <div className={styles.instruction}>
        <span className={styles.badge}>Order Sequence</span>
        <span className={styles.hint}>Use the arrows to arrange the items in the correct order (1 = First, 4 = Last):</span>
      </div>

      <div className={styles.list}>
        {orderedItems.map((item, index) => (
          <div key={item} className={styles.itemCard}>
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
